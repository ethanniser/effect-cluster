/**
 * @since 1.0.0
 */
import * as Equal from "@effect/data/Equal"
import { pipe } from "@effect/data/Function"
import * as HashMap from "@effect/data/HashMap"
import * as HashSet from "@effect/data/HashSet"
import * as Option from "@effect/data/Option"
import * as Cause from "@effect/io/Cause"
import * as Deferred from "@effect/io/Deferred"
import * as Effect from "@effect/io/Effect"
import * as Hub from "@effect/io/Hub"
import * as Queue from "@effect/io/Queue"
import * as Ref from "@effect/io/Ref"
import * as Synchronized from "@effect/io/Ref/Synchronized"
import * as BinaryMessage from "@effect/shardcake/BinaryMessage"
import type * as ByteArray from "@effect/shardcake/ByteArray"
import * as EntityManager from "@effect/shardcake/EntityManager"
import * as EntityState from "@effect/shardcake/EntityState"
import * as Message from "@effect/shardcake/Message"
import * as PodAddress from "@effect/shardcake/PodAddress"
import { Pods } from "@effect/shardcake/Pods"
import type { Replier } from "@effect/shardcake/Replier"
import * as ReplyId from "@effect/shardcake/ReplyId"
import type { Throwable } from "@effect/shardcake/ShardError"
import * as ShardingRegistrationEvent from "@effect/shardcake/ShardingRegistrationEvent"
import { ShardManagerClient } from "@effect/shardcake/ShardManagerClient"
import * as Stream from "@effect/stream/Stream"

import * as Duration from "@effect/data/Duration"
import { equals } from "@effect/data/Equal"
import * as List from "@effect/data/List"
import * as Fiber from "@effect/io/Fiber"
import * as Layer from "@effect/io/Layer"
import * as Schedule from "@effect/io/Schedule"
import type { Scope } from "@effect/io/Scope"
import type * as Schema from "@effect/schema/Schema"
import type { Messenger } from "@effect/shardcake/Messenger"
import * as RecipientType from "@effect/shardcake/RecipientType"
import * as Serialization from "@effect/shardcake/Serialization"
import {
  EntityTypeNotRegistered,
  isEntityNotManagedByThisPodError,
  isPodUnavailableError,
  MessageReturnedNoting,
  NotAMessageWithReplier,
  SendTimeoutException
} from "@effect/shardcake/ShardError"
import * as ShardId from "@effect/shardcake/ShardId"
import * as ShardingConfig from "@effect/shardcake/ShardingConfig"
import * as Storage from "@effect/shardcake/Storage"
import { Sharding } from "./Sharding"

type SingletonEntry = [string, Effect.Effect<never, never, void>, Option.Option<Fiber.Fiber<never, void>>]

/** @internal */
function make(
  address: PodAddress.PodAddress,
  config: ShardingConfig.ShardingConfig,
  shardAssignments: Ref.Ref<HashMap.HashMap<ShardId.ShardId, PodAddress.PodAddress>>,
  entityStates: Ref.Ref<HashMap.HashMap<string, EntityState.EntityState>>,
  singletons: Synchronized.Synchronized<
    List.List<SingletonEntry>
  >,
  replyPromises: Synchronized.Synchronized<
    HashMap.HashMap<ReplyId.ReplyId, Deferred.Deferred<Throwable, Option.Option<any>>>
  >, // promise for each pending reply,
  // lastUnhealthyNodeReported: Ref.Ref<Date>,
  isShuttingDownRef: Ref.Ref<boolean>,
  shardManager: ShardManagerClient,
  pods: Pods,
  storage: Storage.Storage,
  serialization: Serialization.Serialization,
  eventsHub: Hub.Hub<ShardingRegistrationEvent.ShardingRegistrationEvent>
) {
  function getShardId(recipientType: RecipientType.RecipientType<any>, entityId: string): ShardId.ShardId {
    return RecipientType.getShardId(entityId, config.numberOfShards)
  }

  const register = pipe(
    Effect.logDebug(`Registering pod ${PodAddress.show(address)} to Shard Manager`),
    Effect.zipRight(pipe(isShuttingDownRef, Ref.set(false))),
    Effect.zipRight(shardManager.register(address))
  )

  const unregister = pipe(
    shardManager.getAssignments,
    Effect.matchCauseEffect(
      (_) => Effect.logWarningCauseMessage("Shard Manager not available. Can't unregister cleanly", _),
      () =>
        pipe(
          Effect.logDebug(`Stopping local entities`),
          Effect.zipRight(pipe(isShuttingDownRef, Ref.set(true))),
          Effect.zipRight(
            pipe(
              Ref.get(entityStates),
              Effect.flatMap(
                Effect.forEachDiscard(
                  ([name, entityState]) =>
                    pipe(
                      entityState.entityManager.terminateAllEntities,
                      Effect.catchAllCause((_) => Effect.logErrorCauseMessage("Error during stop of entity " + name, _))
                    )
                )
              )
            )
          ),
          Effect.zipRight(Effect.logDebug(`Unregistering pod ${address} to Shard Manager`)),
          Effect.zipRight(shardManager.unregister(address))
        )
    )
  )

  const isSingletonNode: Effect.Effect<never, never, boolean> = pipe(
    Ref.get(shardAssignments),
    Effect.map((_) =>
      pipe(
        HashMap.get(_, ShardId.make(1)),
        Option.match(() => false, equals(address))
      )
    )
  )

  const startSingletonsIfNeeded = pipe(
    Synchronized.updateEffect(
      singletons,
      (singletons) =>
        pipe(
          Effect.forEach(singletons, ([name, run, fa]) =>
            Option.match(
              fa,
              () =>
                pipe(
                  Effect.logDebug("Starting singleton " + name),
                  Effect.zipRight(
                    Effect.map(Effect.forkDaemon(run), (fiber) => [name, run, Option.some(fiber)] as SingletonEntry)
                  )
                ),
              (_) => Effect.succeed([name, run, fa] as SingletonEntry)
            )),
          Effect.map(List.fromIterable)
        )
    ),
    Effect.whenEffect(isSingletonNode),
    Effect.asUnit
  )

  const stopSingletonsIfNeeded = pipe(
    Synchronized.updateEffect(
      singletons,
      (singletons) =>
        pipe(
          Effect.forEach(singletons, ([name, run, fa]) =>
            Option.match(
              fa,
              () => Effect.succeed([name, run, fa] as SingletonEntry),
              (fiber) =>
                pipe(
                  Effect.logDebug("Stopping singleton " + name),
                  Effect.zipRight(
                    Effect.as(Fiber.interrupt(fiber), [name, run, Option.none()] as SingletonEntry)
                  )
                )
            )),
          Effect.map(List.fromIterable)
        )
    ),
    Effect.unlessEffect(isSingletonNode),
    Effect.asUnit
  )

  function registerSingleton(name: string, run: Effect.Effect<never, never, void>): Effect.Effect<never, never, void> {
    return pipe(
      Synchronized.update(singletons, (list) => (List.prepend(list, [name, run, Option.none()] as SingletonEntry))),
      Effect.zipRight(startSingletonsIfNeeded),
      Effect.zipRight(Hub.publish(eventsHub, ShardingRegistrationEvent.SingletonRegistered(name)))
    )
  }

  const registerScoped = Effect.acquireRelease(register, (_) => Effect.orDie(unregister))

  function reply<Reply>(reply: Reply, replier: Replier<Reply>): Effect.Effect<never, never, void> {
    return pipe(
      replyPromises,
      Synchronized.updateEffect((promises) =>
        pipe(
          Effect.whenCase(
            () => pipe(promises, HashMap.get(replier.id)),
            Option.map((deferred) => pipe(deferred, Deferred.succeed(Option.some(reply))))
          ),
          Effect.as(pipe(promises, HashMap.remove(replier.id)))
        )
      )
    )
  }

  function sendToLocalEntity(msg: BinaryMessage.BinaryMessage) {
    return pipe(
      Ref.get(entityStates),
      Effect.flatMap((states) => {
        const a = HashMap.get(states, msg.entityType)
        if (Option.isSome(a)) {
          const state = a.value
          return pipe(
            Effect.Do(),
            Effect.bind("p", () => Deferred.make<never, Option.Option<ByteArray.ByteArray>>()),
            Effect.bind("interruptor", () => Deferred.make<never, void>()),
            Effect.tap(({ interruptor, p }) => state.binaryQueue.offer([msg, p, interruptor])),
            Effect.flatMap(({ interruptor, p }) =>
              pipe(
                Deferred.await(p),
                Effect.onError((_) => Deferred.interrupt(interruptor))
              )
            )
          )
        } else {
          return Effect.fail(EntityTypeNotRegistered(msg.entityType, address))
        }
      })
    )
  }

  function initReply(
    id: ReplyId.ReplyId,
    promise: Deferred.Deferred<Throwable, Option.Option<any>>
  ): Effect.Effect<never, never, void> {
    return pipe(
      replyPromises,
      Synchronized.update(HashMap.set(id, promise)),
      Effect.zipLeft(
        pipe(
          promise,
          Deferred.await,
          Effect.onError((cause) => abortReply(id, Cause.squash(cause) as any)),
          Effect.forkDaemon
        )
      )
    )
  }

  function abortReply(id: ReplyId.ReplyId, ex: Throwable) {
    return pipe(
      replyPromises,
      Synchronized.updateEffect((promises) =>
        pipe(
          Effect.whenCase(() => pipe(promises, HashMap.get(id)), Option.map(Deferred.fail(ex))),
          Effect.as(pipe(promises, HashMap.remove(id)))
        )
      )
    )
  }

  function sendToPod<Msg, Res>(
    recipientTypeName: string,
    entityId: string,
    msg: Msg,
    msgSchema: Schema.Schema<any, Msg>,
    pod: PodAddress.PodAddress,
    replyId: Option.Option<ReplyId.ReplyId>
  ): Effect.Effect<never, Throwable, Option.Option<Res>> {
    const a = pipe(
      serialization.encode(msg, msgSchema),
      Effect.flatMap((bytes) =>
        pipe(
          pods.sendMessage(
            pod,
            BinaryMessage.make(entityId, recipientTypeName, bytes, replyId)
          ),
          Effect.tapError(() => Effect.unit())
        )
      ),
      Effect.flatMap(
        Option.match(
          () => Effect.succeed(Option.none()),
          (bytes) => {
            if (Message.isMessage<Res>(msg)) {
              return pipe(serialization.decode(bytes, msg.replier.schema), Effect.map(Option.some))
            }
            return Effect.die("Error, schema is missing in request message")
          }
        )
      )
    )
    return a
    /*
serialization
        .encode(msg)
        .flatMap(bytes =>
          pods
            .sendMessage(pod, BinaryMessage(entityId, recipientTypeName, bytes, replyId))
            .tapError {
              ZIO.whenCase(_) { case PodUnavailable(pod) =>
                val notify = Clock.currentDateTime.flatMap(cdt =>
                  lastUnhealthyNodeReported
                    .updateAndGet(old =>
                      if (old.plusNanos(config.unhealthyPodReportInterval.toNanos) isBefore cdt) cdt
                      else old
                    )
                    .map(_ isEqual cdt)
                )
                ZIO.whenZIO(notify)(
                  (shardManager.notifyUnhealthyPod(pod) *>
                    // just in case we missed the update from the pubsub, refresh assignments
                    shardManager.getAssignments
                      .flatMap(updateAssignments(_, fromShardManager = true))).forkDaemon
                )
              }
            }
            .flatMap(ZIO.foreach(_)(serialization.decode[Res]))
        )
    */
    // TODO: handle real world cases (only simulateRemotePods for now)
    return pipe(
      serialization.encode(msg, msgSchema),
      Effect.flatMap((bytes) => sendToLocalEntity(BinaryMessage.make(entityId, recipientTypeName, bytes, replyId))),
      Effect.flatMap((_) => {
        if (Option.isSome(_)) {
          if (Message.isMessage<Res>(msg)) {
            return pipe(
              serialization.decode<Res>(_.value, msg.replier.schema),
              Effect.map(Option.some)
            )
          } else {
            return Effect.die(NotAMessageWithReplier(msg))
          }
        }
        return Effect.succeed(Option.none())
      })
    )
  }

  function messenger<Msg>(
    entityType: RecipientType.RecipientType<Msg>,
    sendTimeout: Option.Option<Duration.Duration> = Option.none()
  ): Messenger<Msg> {
    const timeout = pipe(
      sendTimeout,
      Option.getOrElse(() => config.sendTimeout)
    )

    function sendDiscard(entityId: string) {
      return (msg: Msg) => pipe(sendMessage(entityId, msg, Option.none()), Effect.timeout(timeout), Effect.asUnit)
    }

    function sendMessage<Res>(entityId: string, msg: Msg, replyId: Option.Option<ReplyId.ReplyId>) {
      const shardId = getShardId(entityType, entityId)

      const trySend: Effect.Effect<never, Throwable, Option.Option<Res>> = pipe(
        Effect.Do(),
        Effect.bind("shards", () => Ref.get(shardAssignments)),
        Effect.let("pod", ({ shards }) => HashMap.get(shards, shardId)),
        Effect.bind("response", ({ pod }) => {
          if (Option.isSome(pod)) {
            const send = sendToPod<Msg, Res>(
              entityType.name,
              entityId,
              msg,
              entityType.schema,
              pod.value,
              replyId
            )
            return pipe(
              send,
              Effect.catchSome((_) => {
                if (isEntityNotManagedByThisPodError(_) || isPodUnavailableError(_)) {
                  return pipe(
                    Effect.sleep(Duration.millis(200)),
                    Effect.zipRight(trySend),
                    Option.some
                  )
                }
                return Option.none()
              })
            )
          }

          return pipe(Effect.sleep(Duration.millis(100)), Effect.zipRight(trySend))
        }),
        Effect.map((_) => _.response)
      )

      return trySend
    }

    function send(entityId: string) {
      return <A extends Msg & Message.Message<any>>(fn: (replyId: ReplyId.ReplyId) => Msg) => {
        return pipe(
          ReplyId.makeEffect,
          Effect.flatMap((replyId) => {
            const body = fn(replyId)
            return pipe(
              sendMessage<Message.Success<A>>(entityId, body, Option.some(replyId)),
              Effect.flatMap((_) => {
                if (Option.isSome(_)) return Effect.succeed(_.value)
                return Effect.fail(MessageReturnedNoting(entityId, body))
              }),
              Effect.timeoutFail(() => SendTimeoutException(entityType, entityId, body), timeout),
              Effect.interruptible
            )
          })
        )
      }
    }

    return { sendDiscard, send }
  }

  function registerRecipient<R, Req>(
    recipientType: RecipientType.RecipientType<Req>,
    behavior: (entityId: string, dequeue: Queue.Dequeue<Req>) => Effect.Effect<R, never, void>,
    terminateMessage: (p: Deferred.Deferred<never, void>) => Option.Option<Req> = () => Option.none(),
    entityMaxIdleTime: Option.Option<Duration.Duration> = Option.none()
  ) {
    return Effect.gen(function*($) {
      const entityManager = yield* $(
        EntityManager.make(
          recipientType,
          behavior,
          terminateMessage,
          self,
          config,
          entityMaxIdleTime
        )
      )

      const binaryQueue = yield* $(
        pipe(
          Queue.unbounded<
            readonly [
              BinaryMessage.BinaryMessage,
              Deferred.Deferred<Throwable, Option.Option<ByteArray.ByteArray>>,
              Deferred.Deferred<never, void>
            ]
          >()
        )
      )

      yield* $(
        pipe(
          entityStates,
          Ref.update(HashMap.set(recipientType.name, EntityState.make(binaryQueue, entityManager)))
        )
      )

      yield* $(Effect.log("Starting drainer for " + recipientType.name))

      yield* $(
        pipe(
          Stream.fromQueue(binaryQueue),
          Stream.mapEffect(([msg, p, interruptor]) =>
            pipe(
              Effect.Do(),
              Effect.bind("req", () => serialization.decode<Req>(msg.body, recipientType.schema)),
              Effect.bind("p2", () => Deferred.make<Throwable, Option.Option<any>>()),
              Effect.bind("resOption", (_) =>
                pipe(
                  entityManager.send(msg.entityId, _.req, msg.replyId, _.p2),
                  Effect.zipRight(Deferred.await(_.p2)),
                  Effect.onError((__) => Deferred.interrupt(_.p2))
                )),
              Effect.bind("res", (_) =>
                pipe(
                  _.resOption,
                  Option.match(
                    () => Effect.succeed(Option.none()),
                    (__) => {
                      if (Message.isMessage(_.req)) {
                        return pipe(
                          serialization.encode(__, _.req.replier.schema),
                          Effect.map(Option.some)
                        )
                      }
                      return Effect.die(NotAMessageWithReplier(_.req))
                    }
                  )
                )),
              Effect.tap((_) => pipe(p, Deferred.succeed(_.res))),
              Effect.catchAllCause((cause) => pipe(p, Deferred.fail(Cause.squash(cause)))),
              Effect.raceFirst(Deferred.await(interruptor)),
              Effect.fork,
              Effect.asUnit
            )
          ),
          Stream.runDrain,
          Effect.forkScoped
        )
      )
    })
  }

  function registerEntity<R, Req>(
    entityType: RecipientType.RecipientType<Req>,
    behavior: (entityId: string, dequeue: Queue.Dequeue<Req>) => Effect.Effect<R, never, void>,
    terminateMessage: (p: Deferred.Deferred<never, void>) => Option.Option<Req> = () => Option.none(),
    entityMaxIdleTime: Option.Option<Duration.Duration> = Option.none()
  ): Effect.Effect<Scope | R, never, void> {
    return registerRecipient(entityType, behavior, terminateMessage, entityMaxIdleTime)
  }

  function isEntityOnLocalShards(
    recipientType: RecipientType.RecipientType<any>,
    entityId: string
  ): Effect.Effect<never, never, boolean> {
    return pipe(
      Effect.Do(),
      Effect.bind("shards", () => Ref.get(shardAssignments)),
      Effect.let("shardId", () => getShardId(recipientType, entityId)),
      Effect.let("pod", ({ shardId, shards }) => pipe(shards, HashMap.get(shardId))),
      Effect.map((_) => Option.isSome(_.pod) && equals(_.pod.value, address))
    )
  }

  const refreshAssignments: Effect.Effect<never, never, void> = pipe(
    Stream.fromEffect(Effect.map(shardManager.getAssignments, (_) => [_, true] as const)),
    Stream.merge(
      pipe(
        storage.assignmentsStream,
        Stream.map((_) => [_, false] as const)
      )
    ),
    Stream.mapEffect(([assignmentsOpt, fromShardManager]) => updateAssignments(assignmentsOpt, fromShardManager)),
    Stream.runDrain,
    Effect.retry(Schedule.fixed(config.refreshAssignmentsRetryInterval)),
    Effect.interruptible,
    Effect.forkDaemon,
    // TODO: missing withFinalizer (fiber interrupt)
    Effect.asUnit
  )

  function updateAssignments(
    assignmentsOpt: HashMap.HashMap<ShardId.ShardId, Option.Option<PodAddress.PodAddress>>,
    fromShardManager: boolean
  ) {
    const assignments = HashMap.mapWithIndex(assignmentsOpt, (v, _) => Option.getOrElse(v, () => address))

    if (fromShardManager) {
      return Ref.update(shardAssignments, (map) => (HashMap.isEmpty(map) ? assignments : map))
    }

    return Ref.update(shardAssignments, (map) => {
      // we keep self assignments (we don't override them with the new assignments
      // because only the Shard Manager is able to change assignments of the current node, via assign/unassign
      return HashMap.union(
        pipe(
          assignments,
          HashMap.filterWithIndex((pod, _) => !Equal.equals(pod, address))
        ),
        pipe(
          map,
          HashMap.filterWithIndex((pod, _) => Equal.equals(pod, address))
        )
      )
    })
  }

  const isShuttingDown = Ref.get(isShuttingDownRef)

  function assign(shards: HashSet.HashSet<ShardId.ShardId>) {
    return pipe(
      Ref.update(shardAssignments, (_) => HashSet.reduce(shards, _, (_, shardId) => HashMap.set(_, shardId, address))),
      Effect.zipRight(startSingletonsIfNeeded),
      Effect.zipLeft(Effect.logDebug("Assigned shards: " + JSON.stringify(shards))),
      Effect.unlessEffect(isShuttingDown),
      Effect.asUnit
    )
  }

  function unassign(shards: HashSet.HashSet<ShardId.ShardId>) {
    return pipe(
      Ref.update(shardAssignments, (_) =>
        HashSet.reduce(shards, _, (_, shardId) => {
          const value = HashMap.get(_, shardId)
          if (Option.isSome(value) && equals(value.value, address)) {
            return HashMap.remove(_, shardId)
          }
          return _
        })),
      Effect.zipRight(stopSingletonsIfNeeded),
      Effect.zipLeft(Effect.logDebug("Unassigning shards: " + JSON.stringify(shards)))
    )
  }

  const self: Sharding = {
    getShardId,
    register,
    unregister,
    reply,
    messenger,
    isEntityOnLocalShards,
    isShuttingDown,
    initReply,
    registerSingleton,
    registerScoped,
    registerEntity,
    refreshAssignments,
    assign,
    unassign,
    sendToLocalEntity
  }

  return self
}

/**
 * @since 1.0.0
 * @category layers
 */
export const live = Layer.scoped(
  Sharding,
  pipe(
    Effect.Do(),
    Effect.bind("config", () => ShardingConfig.ShardingConfig),
    Effect.bind("pods", () => Pods),
    Effect.bind("shardManager", () => ShardManagerClient),
    Effect.bind("storage", () => Storage.Storage),
    Effect.bind("serialization", () => Serialization.Serialization),
    Effect.bind("shardsCache", () => Ref.make(HashMap.empty<ShardId.ShardId, PodAddress.PodAddress>())),
    Effect.bind("entityStates", () => Ref.make(HashMap.empty<string, EntityState.EntityState>())),
    Effect.bind("singletons", (_) =>
      pipe(
        Synchronized.make<List.List<SingletonEntry>>(List.nil())
        /*
        TODO(Mattia): add finalizer
        Effect.flatMap((_) =>
          Effect.ensuring(Synchronized.get(_, (singletons) =>
            Effect.forEach(singletons, ([_, __, fiber]) =>
              Option.isSome(fiber) ? Fiber.interrupt(fiber) : Effect.unit())))
        )*/
      )),
    Effect.bind("shuttingDown", () => Ref.make(false)),
    Effect.bind("promises", () =>
      Synchronized.make(
        HashMap.empty<ReplyId.ReplyId, Deferred.Deferred<Throwable, Option.Option<any>>>()
      )),
    Effect.bind("eventsHub", () => Hub.unbounded<ShardingRegistrationEvent.ShardingRegistrationEvent>()),
    Effect.let("sharding", (_) =>
      make(
        PodAddress.make(_.config.selfHost, _.config.shardingPort),
        _.config,
        _.shardsCache,
        _.entityStates,
        _.singletons,
        _.promises,
        _.shuttingDown,
        _.shardManager,
        _.pods,
        _.storage,
        _.serialization,
        _.eventsHub
      )),
    Effect.tap((_) => _.sharding.refreshAssignments),
    Effect.map((_) => _.sharding)
  )
)
