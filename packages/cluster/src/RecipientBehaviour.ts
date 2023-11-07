/**
 * A module that provides utilities to build basic behaviours
 * @since 1.0.0
 */
import * as PoisonPill from "@effect/cluster/PoisonPill"
import type * as ReplyId from "@effect/cluster/ReplyId"
import type * as ShardingError from "@effect/cluster/ShardingError"
import { Deferred } from "effect"
import { Tag } from "effect/Context"
import type * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import { pipe } from "effect/Function"
import type * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import type * as Scope from "effect/Scope"

/**
 * The context where a RecipientBehaviour is running, knows the current entityId, entityType, etc...
 * @since 1.0.0
 * @category models
 */
export interface RecipientBehaviourContext {
  readonly entityId: string
  readonly reply: (replyId: ReplyId.ReplyId, reply: unknown) => Effect.Effect<never, never, void>
}

/**
 * A tag to access current RecipientBehaviour
 * @since 1.0.0
 * @category context
 */
export const RecipientBehaviourContext = Tag<RecipientBehaviourContext>()

/**
 * An alias to a RecipientBehaviour
 * @since 1.0.0
 * @category models
 */
export interface RecipientBehaviour<R, Msg> {
  (
    entityId: string
  ): Effect.Effect<
    R | RecipientBehaviourContext | Scope.Scope,
    never,
    (message: Msg) => Effect.Effect<never, ShardingError.ShardingErrorMessageQueue, void>
  >
}

/**
 * An utility that process a message at a time, or interrupts on PoisonPill
 * @since 1.0.0
 * @category utils
 */
export type EntityBehaviourOptions = {
  entityMaxIdleTime?: Option.Option<Duration.Duration>
}

export function fromInMemoryQueue<R, Msg>(
  handler: (entityId: string, dequeue: Queue.Dequeue<Msg | PoisonPill.PoisonPill>) => Effect.Effect<R, never, void>
): RecipientBehaviour<R, Msg> {
  return (entityId) =>
    pipe(
      Deferred.make<never, boolean>(),
      Effect.flatMap((shutdownCompleted) =>
        pipe(
          Effect.acquireRelease(
            Queue.unbounded<Msg | PoisonPill.PoisonPill>(),
            (queue) =>
              pipe(
                Queue.offer(queue, PoisonPill.make),
                Effect.zipLeft(Deferred.await(shutdownCompleted)),
                Effect.uninterruptible
              )
          ),
          Effect.tap((queue) =>
            pipe(
              handler(entityId, queue),
              Effect.ensuring(Deferred.succeed(shutdownCompleted, true)),
              Effect.forkDaemon
            )
          ),
          Effect.map((queue) => (message: Msg) => Queue.offer(queue, message))
        )
      )
    )
}

export function mapOffer<Msg1, Msg>(
  f: (
    offer: (message: Msg1) => Effect.Effect<never, ShardingError.ShardingErrorMessageQueue, void>
  ) => (message: Msg) => Effect.Effect<never, ShardingError.ShardingErrorMessageQueue, void>
) {
  return <R>(base: RecipientBehaviour<R, Msg1>): RecipientBehaviour<R, Msg> => (entityId) =>
    pipe(
      base(entityId),
      Effect.map((offer) => f(offer))
    )
}
