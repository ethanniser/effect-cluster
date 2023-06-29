import { pipe } from "@effect/data/Function"
import * as Effect from "@effect/io/Effect"
import * as Layer from "@effect/io/Layer"
import type * as PodAddress from "@effect/shardcake/PodAddress"
import * as Pods from "@effect/shardcake/Pods"
import { isFetchError, PodUnavailable } from "@effect/shardcake/ShardError"
import * as ShardingProtocolHttp from "@effect/shardcake/ShardingProtocolHttp"
import { send } from "./utils"

function asHttpUrl(pod: PodAddress.PodAddress): string {
  return `http://${pod.host}:${pod.port}/`
}

export const httpPods = Layer.succeed(Pods.Pods, {
  [Pods.PodsTypeId]: {},
  assignShards: (pod, shards) =>
    pipe(
      send(ShardingProtocolHttp.AssignShard_, ShardingProtocolHttp.AssignShardResult_)(asHttpUrl(pod), {
        _tag: "AssignShards",
        shards: Array.from(shards)
      }),
      Effect.orDie
    ),
  unassignShards: (pod, shards) =>
    pipe(
      send(ShardingProtocolHttp.UnassignShards_, ShardingProtocolHttp.UnassignShardsResult_)(asHttpUrl(pod), {
        _tag: "UnassignShards",
        shards: Array.from(shards)
      }),
      Effect.orDie
    ),
  ping: (pod) =>
    pipe(
      send(ShardingProtocolHttp.PingShards_, ShardingProtocolHttp.PingShardsResult_)(asHttpUrl(pod), {
        _tag: "PingShards"
      }),
      Effect.catchAll((e) => {
        if (isFetchError(e)) {
          return Effect.fail(PodUnavailable(pod))
        }
        return Effect.die(e)
      })
    ),
  sendMessage: (pod, message) =>
    pipe(
      send(ShardingProtocolHttp.Send_, ShardingProtocolHttp.SendResult_)(asHttpUrl(pod), {
        _tag: "Send",
        message
      }),
      Effect.orDie
    )
})
