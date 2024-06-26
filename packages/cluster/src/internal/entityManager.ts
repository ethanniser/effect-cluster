import * as Clock from "effect/Clock"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import { pipe } from "effect/Function"
import * as HashMap from "effect/HashMap"
import * as HashSet from "effect/HashSet"
import * as Option from "effect/Option"
import * as Scope from "effect/Scope"
import * as RefSynchronized from "effect/SynchronizedRef"
import type * as Message from "../Message.js"
import type * as MessageState from "../MessageState.js"
import type * as RecipientBehaviour from "../RecipientBehaviour.js"
import * as RecipientBehaviourContext from "../RecipientBehaviourContext.js"
import type * as RecipientType from "../RecipientType.js"
import type * as ShardId from "../ShardId.js"
import type * as Sharding from "../Sharding.js"
import type * as ShardingConfig from "../ShardingConfig.js"
import * as ShardingException from "../ShardingException.js"
import * as EntityState from "./entityState.js"

/** @internal */
const EntityManagerSymbolKey = "@effect/cluster/EntityManager"

/** @internal */
export const EntityManagerTypeId = Symbol.for(
  EntityManagerSymbolKey
)

/** @internal */
export type EntityManagerTypeId = typeof EntityManagerTypeId

/** @internal */
export interface EntityManager<Msg extends Message.Message.Any> {
  readonly [EntityManagerTypeId]: EntityManagerTypeId

  /** @internal */
  readonly recipientType: RecipientType.RecipientType<Msg>

  /** @internal */
  readonly sendAndGetState: <A extends Msg>(
    entityId: string,
    req: A
  ) => Effect.Effect<
    MessageState.MessageState<Message.Message.Exit<A>>,
    | ShardingException.EntityNotManagedByThisPodException
    | ShardingException.PodUnavailableException
    | ShardingException.ExceptionWhileOfferingMessageException
  >

  /** @internal */
  readonly terminateEntitiesOnShards: (
    shards: HashSet.HashSet<ShardId.ShardId>
  ) => Effect.Effect<void>

  /** @internal */
  readonly terminateAllEntities: Effect.Effect<void>
}

/** @internal */
export function make<Msg extends Message.Message.Any, R>(
  recipientType: RecipientType.RecipientType<Msg>,
  recipientBehaviour: RecipientBehaviour.RecipientBehaviour<Msg, R>,
  sharding: Sharding.Sharding,
  config: ShardingConfig.ShardingConfig,
  options: RecipientBehaviour.EntityBehaviourOptions = {}
) {
  return Effect.gen(function*(_) {
    const entityMaxIdle = options.entityMaxIdleTime || Option.none()
    const env = yield* _(Effect.context<Exclude<R, RecipientBehaviourContext.RecipientBehaviourContext>>())
    const entityStates = yield* _(
      RefSynchronized.make<
        HashMap.HashMap<
          string,
          EntityState.EntityState<Msg>
        >
      >(HashMap.empty())
    )

    function startExpirationFiber(entityId: string) {
      const maxIdleMillis = pipe(
        entityMaxIdle,
        Option.getOrElse(() => config.entityMaxIdleTime),
        Duration.toMillis
      )

      function sleep(duration: number): Effect.Effect<void> {
        return pipe(
          Effect.Do,
          Effect.zipLeft(Clock.sleep(Duration.millis(duration))),
          Effect.bind("cdt", () => Clock.currentTimeMillis),
          Effect.bind("map", () => RefSynchronized.get(entityStates)),
          Effect.let("lastReceivedAt", ({ map }) =>
            pipe(
              HashMap.get(map, entityId),
              Option.map((_) => _.lastReceivedAt),
              Option.getOrElse(() => 0)
            )),
          Effect.let("remaining", ({ cdt, lastReceivedAt }) => (maxIdleMillis - cdt + lastReceivedAt)),
          Effect.tap((_) => _.remaining > 0 ? sleep(_.remaining) : Effect.void)
        )
      }

      return pipe(
        sleep(maxIdleMillis),
        Effect.zipRight(forkEntityTermination(entityId)),
        Effect.asVoid,
        Effect.interruptible,
        Effect.annotateLogs("entityId", entityId),
        Effect.annotateLogs("recipientType", recipientType.name),
        Effect.forkDaemon
      )
    }

    /**
     * Performs proper termination of the entity, interrupting the expiration timer, closing the scope and failing pending replies
     */
    function terminateEntity(entityId: string) {
      return pipe(
        // get the things to cleanup
        RefSynchronized.get(
          entityStates
        ),
        Effect.map(HashMap.get(entityId)),
        Effect.flatMap(Option.match({
          // there is no entity state to cleanup
          onNone: () => Effect.void,
          // found it!
          onSome: (entityState) =>
            pipe(
              // interrupt the expiration timer
              Fiber.interrupt(entityState.expirationFiber),
              // close the scope of the entity,
              Effect.ensuring(Scope.close(entityState.executionScope, Exit.void)),
              // remove the entry from the map
              Effect.ensuring(RefSynchronized.update(entityStates, HashMap.remove(entityId))),
              // log error if happens
              Effect.catchAllCause(Effect.logError),
              Effect.asVoid,
              Effect.annotateLogs("entityId", entityId),
              Effect.annotateLogs("recipientType", recipientType.name)
            )
        }))
      )
    }

    /**
     * Begins entity termination (if needed) and return the fiber to wait for completed termination (if any)
     */
    function forkEntityTermination(
      entityId: string
    ): Effect.Effect<Option.Option<Fiber.RuntimeFiber<void, never>>> {
      return RefSynchronized.modifyEffect(entityStates, (entityStatesMap) =>
        pipe(
          HashMap.get(entityStatesMap, entityId),
          Option.match({
            // if no entry is found, the entity has succefully shut down
            onNone: () => Effect.succeed([Option.none(), entityStatesMap] as const),
            // there is an entry, so we should begin termination
            onSome: (entityState) =>
              pipe(
                entityState.terminationFiber,
                Option.match({
                  // termination has already begun, keep everything as-is
                  onSome: () => Effect.succeed([entityState.terminationFiber, entityStatesMap] as const),
                  // begin to terminate the queue
                  onNone: () =>
                    pipe(
                      terminateEntity(entityId),
                      Effect.forkDaemon,
                      Effect.map((terminationFiber) =>
                        [
                          Option.some(terminationFiber),
                          HashMap.modify(entityStatesMap, entityId, EntityState.withTerminationFiber(terminationFiber))
                        ] as const
                      )
                    )
                })
              )
          })
        ))
    }

    function getOrCreateEntityState(
      entityId: string
    ): Effect.Effect<
      Option.Option<EntityState.EntityState<Msg>>,
      ShardingException.EntityNotManagedByThisPodException
    > {
      return RefSynchronized.modifyEffect(entityStates, (map) =>
        pipe(
          HashMap.get(map, entityId),
          Option.match({
            onSome: (entityState) =>
              pipe(
                entityState.terminationFiber,
                Option.match({
                  // offer exists, delay the interruption fiber and return the offer
                  onNone: () =>
                    pipe(
                      Clock.currentTimeMillis,
                      Effect.map(
                        (cdt) =>
                          [
                            Option.some(entityState),
                            HashMap.modify(map, entityId, EntityState.withLastReceivedAd(cdt))
                          ] as const
                      )
                    ),
                  // the queue is shutting down, stash and retry
                  onSome: () => Effect.succeed([Option.none(), map] as const)
                })
              ),
            onNone: () =>
              Effect.flatMap(sharding.isShuttingDown, (isGoingDown) => {
                if (isGoingDown) {
                  // don't start any fiber while sharding is shutting down
                  return Effect.fail(new ShardingException.EntityNotManagedByThisPodException({ entityId }))
                } else {
                  // offer doesn't exist, create a new one
                  return Effect.gen(function*(_) {
                    const executionScope = yield* _(Scope.make())
                    const expirationFiber = yield* _(startExpirationFiber(entityId))
                    const cdt = yield* _(Clock.currentTimeMillis)
                    const forkShutdown = pipe(forkEntityTermination(entityId), Effect.asVoid)
                    const shardId = sharding.getShardId(entityId)

                    const sendAndGetState = yield* _(pipe(
                      recipientBehaviour,
                      Scope.extend(executionScope),
                      Effect.provideService(
                        RecipientBehaviourContext.RecipientBehaviourContext,
                        RecipientBehaviourContext.make({
                          entityId,
                          shardId,
                          recipientType: recipientType as any,
                          forkShutdown
                        })
                      ),
                      Effect.provide(env)
                    ))

                    const entityState = EntityState.make({
                      sendAndGetState: sendAndGetState as any, // TODO
                      expirationFiber,
                      executionScope,
                      terminationFiber: Option.none(),
                      lastReceivedAt: cdt
                    })

                    return [
                      Option.some(entityState),
                      HashMap.set(
                        map,
                        entityId,
                        entityState
                      )
                    ] as const
                  })
                }
              })
          })
        ))
    }

    function sendAndGetState<A extends Msg>(
      entityId: string,
      req: A
    ): Effect.Effect<
      MessageState.MessageState<Message.Message.Exit<A>>,
      | ShardingException.EntityNotManagedByThisPodException
      | ShardingException.PodUnavailableException
      | ShardingException.ExceptionWhileOfferingMessageException
    > {
      return pipe(
        Effect.Do,
        Effect.tap(() => {
          // first, verify that this entity should be handled by this pod
          if (recipientType._tag === "EntityType") {
            return Effect.asVoid(Effect.unlessEffect(
              Effect.fail(new ShardingException.EntityNotManagedByThisPodException({ entityId })),
              sharding.isEntityOnLocalShards(entityId)
            ))
          } else if (recipientType._tag === "TopicType") {
            return Effect.void
          }
          return Effect.die("Unhandled recipientType")
        }),
        Effect.bind("maybeEntityState", () => getOrCreateEntityState(entityId)),
        Effect.flatMap((_) =>
          pipe(
            _.maybeEntityState,
            Option.match({
              onNone: () =>
                pipe(
                  Effect.sleep(Duration.millis(100)),
                  Effect.flatMap(() => sendAndGetState(entityId, req))
                ),
              onSome: (entityState) => {
                return entityState.sendAndGetState(req)
              }
            })
          )
        )
      )
    }

    const terminateAllEntities = pipe(
      RefSynchronized.get(entityStates),
      Effect.map(HashMap.keySet),
      Effect.flatMap(terminateEntities)
    )

    function terminateEntities(
      entitiesToTerminate: HashSet.HashSet<
        string
      >
    ) {
      return pipe(
        entitiesToTerminate,
        Effect.forEach(
          (entityId) =>
            pipe(
              forkEntityTermination(entityId),
              Effect.flatMap((_) =>
                Option.match(_, {
                  onNone: () => Effect.void,
                  onSome: (terminationFiber) =>
                    pipe(
                      Fiber.await(terminationFiber),
                      Effect.timeout(config.entityTerminationTimeout),
                      Effect.match({
                        onFailure: () =>
                          Effect.logError(
                            `Entity ${
                              recipientType.name + "#" + entityId
                            } termination is taking more than expected entityTerminationTimeout (${
                              Duration.toMillis(config.entityTerminationTimeout)
                            }ms).`
                          ),
                        onSuccess: () =>
                          Effect.logDebug(
                            `Entity ${recipientType.name + "#" + entityId} cleaned up.`
                          )
                      }),
                      Effect.asVoid
                    )
                })
              )
            ),
          { concurrency: "inherit" }
        ),
        Effect.asVoid
      )
    }

    function terminateEntitiesOnShards(shards: HashSet.HashSet<ShardId.ShardId>) {
      return pipe(
        RefSynchronized.modify(entityStates, (entities) => [
          HashMap.filter(
            entities,
            (_, entityId) => HashSet.has(shards, sharding.getShardId(entityId))
          ),
          entities
        ]),
        Effect.map(HashMap.keySet),
        Effect.flatMap(terminateEntities)
      )
    }

    const self: EntityManager<Msg> = {
      [EntityManagerTypeId]: EntityManagerTypeId,
      recipientType,
      sendAndGetState,
      terminateAllEntities,
      terminateEntitiesOnShards
    }
    return self
  })
}
