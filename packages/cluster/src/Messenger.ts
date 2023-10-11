/**
 * @since 1.0.0
 */
import type * as Message from "@effect/cluster/Message"
import * as ShardingError from "@effect/cluster/ShardingError"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Either from "effect/Either"
import { pipe } from "effect/Function"
import * as Stream from "effect/Stream"

/**
 * An interface to communicate with a remote entity
 * @tparam Msg the type of message that can be sent to this entity type
 * @since 1.0.0
 * @category models
 */
export interface Messenger<Msg> {
  /**
   * Send a message without waiting for a response (fire and forget)
   * @since 1.0.0
   */
  sendDiscard(entityId: string): (msg: Msg) => Effect.Effect<never, ShardingError.ShardingError, void>

  /**
   * Send a message and wait for a response of type `Res`
   * @since 1.0.0
   */
  send(
    entityId: string
  ): <A extends Msg & Message.Message<any>>(
    msg: A
  ) => Effect.Effect<never, ShardingError.ShardingError, Message.Success<A>>

  /**
   * Send a message and receive a stream of responses of type `Res`.
   *
   * Note: The returned stream will fail with a `PodUnavailable` error if the remote entity is rebalanced while
   * streaming responses. See `sendStreamAutoRestart` for an alternative that will automatically restart the stream
   * in case of rebalance.
   * @since 1.0.0
   */
  sendStream(
    entityId: string
  ): <A extends Msg & Message.Message<any>>(
    msg: A
  ) => Effect.Effect<
    never,
    ShardingError.ShardingError,
    Stream.Stream<
      never,
      ShardingError.ShardingError,
      Message.Success<A>
    >
  >
}

/**
 * Send a message and receive a stream of responses of type `Res` while restarting the stream when the remote entity
 * is rebalanced.
 *
 * To do so, we need a "cursor" so the stream of responses can be restarted where it ended before the rebalance. That
 * is, the first message sent to the remote entity contains the given initial cursor value and we extract an updated
 * cursor from the responses so that when the remote entity is rebalanced, a new message can be sent with the right
 * cursor according to what we've seen in the previous stream of responses.
 * @since 1.0.0
 */
export function sendStreamAutoRestart<Msg, Cursor>(
  messenger: Messenger<Msg>,
  entityId: string,
  cursor: Cursor
) {
  return <A extends Msg & Message.Message<any>>(fn: (cursor: Cursor) => A) =>
  (
    updateCursor: (cursor: Cursor, res: Message.Success<A>) => Cursor
  ): Stream.Stream<never, ShardingError.ShardingError, Message.Success<A>> => {
    return pipe(
      messenger.sendStream(entityId)(fn(cursor)),
      Stream.unwrap,
      Stream.either,
      Stream.mapAccum(cursor, (c, either) =>
        Either.match(either, {
          onLeft: (
            err
          ) => [
            c,
            Either.left([c, err]) as Either.Either<[Cursor, ShardingError.ShardingError], Message.Success<A>>
          ],
          onRight: (res) =>
            [
              updateCursor(c, res),
              Either.right(res) as Either.Either<[Cursor, ShardingError.ShardingError], Message.Success<A>>
            ] as const
        })),
      Stream.flatMap(Either.match({
        onRight: (res) => Stream.succeed(res),
        onLeft: ([cursor, err]) =>
          ShardingError.isShardingErrorPodUnavailable(err) ?
            pipe(
              Effect.sleep(Duration.millis(200)),
              Stream.fromEffect,
              Stream.zipRight(sendStreamAutoRestart(messenger, entityId, cursor)(fn)(updateCursor))
            ) :
            Stream.fail(err)
      }))
    )
  }
}
