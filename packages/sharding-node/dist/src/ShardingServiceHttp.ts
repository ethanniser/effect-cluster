/**
 * @since 1.0.0
 */
import * as Either from "@effect/data/Either"
import { pipe } from "@effect/data/Function"
import * as HashSet from "@effect/data/HashSet"
import * as Effect from "@effect/io/Effect"
import * as Layer from "@effect/io/Layer"
import * as Http from "@effect/platform-node/HttpServer"
import * as ShardingProtocolHttp from "@effect/sharding-node/ShardingProtocolHttp"
import { jsonStringify, uint8ArrayFromStringStream } from "@effect/sharding-node/utils"
import * as Sharding from "@effect/sharding/Sharding"
import * as ShardingConfig from "@effect/sharding/ShardingConfig"
import * as Stream from "@effect/stream/Stream"
import { createServer } from "node:http"

const internalServer = Layer.unwrapEffect(Effect.gen(function*(_) {
  const config = yield* _(ShardingConfig.ShardingConfig)

  return Http.server.layer(() => createServer(), { port: config.shardingPort })
}))

/**
 * @since 1.0.0
 * @category layers
 */
export const shardingServiceHttp = Layer.scopedDiscard(
  Effect.gen(function*(_) {
    const sharding = yield* _(Sharding.Sharding)

    return yield* _(Http.router.empty.pipe(
      Http.router.post(
        "/assign-shards",
        Effect.gen(function*(_) {
          const body = yield* _(Http.request.schemaBodyJson(ShardingProtocolHttp.AssignShard_))
          yield* _(sharding.assign(HashSet.fromIterable(body.shards)))
          return yield* _(Http.response.json(true))
        })
      ),
      Http.router.post(
        "/unassign-shards",
        Effect.gen(function*(_) {
          const body = yield* _(Http.request.schemaBodyJson(ShardingProtocolHttp.UnassignShards_))
          yield* _(sharding.unassign(HashSet.fromIterable(body.shards)))
          return yield* _(Http.response.json(true))
        })
      ),
      Http.router.get(
        "/ping",
        Effect.gen(function*(_) {
          return yield* _(Http.response.json(true))
        })
      ),
      Http.router.post(
        "/send-message",
        Effect.gen(function*(_) {
          const body = yield* _(Http.request.schemaBodyJson(ShardingProtocolHttp.Send_))
          const result = yield* _(
            sharding.sendToLocalEntitySingleReply(body.message),
            Effect.match({
              onFailure: Either.left,
              onSuccess: Either.right
            })
          )
          return yield* _(Http.response.schemaJson(ShardingProtocolHttp.SendResult_)(result))
        })
      ),
      Http.router.post(
        "/send-message-streaming",
        Effect.gen(function*(_) {
          const body = yield* _(Http.request.schemaBodyJson(ShardingProtocolHttp.SendStream_))

          const result = pipe(
            sharding.sendToLocalEntityStreamingReply(body.message),
            Stream.map((_) => Either.right(_)),
            Stream.catchAll((e) => Stream.succeed(Either.left(e))),
            Stream.mapEffect((_) => jsonStringify(_, ShardingProtocolHttp.SendStreamResultItem_)),
            uint8ArrayFromStringStream()
          )

          return (Http.response.stream(result, { contentType: "text/event-stream" }))
        })
      ),
      Http.server.serve(Http.middleware.logger)
    ))
  })
).pipe(Layer.use(internalServer))