/**
 * @since 1.0.0
 */

import * as HashMap from "@effect/data/HashMap";
import * as Effect from "@effect/io/Effect";
import * as Layer from "@effect/io/Layer";
import * as Http from "@effect/platform/HttpClient";
import * as ShardManagerProtocolHttp from "@effect/sharding-node/ShardManagerProtocolHttp";
import * as Pod from "@effect/sharding/Pod";
import * as ShardingConfig from "@effect/sharding/ShardingConfig";
import * as ShardManagerClient from "@effect/sharding/ShardManagerClient";
/**
 * @since 1.0.0
 * @category layers
 */
export const shardManagerClientHttp = /*#__PURE__*/Layer.effect(ShardManagerClient.ShardManagerClient, Effect.gen(function* (_) {
  const config = yield* _(ShardingConfig.ShardingConfig);
  const client = yield* _(Http.client.Client, Effect.map(Http.client.filterStatusOk));
  return {
    register: podAddress => Effect.gen(function* (_) {
      const request = yield* _(Http.request.post("/register"), Http.request.prependUrl(config.shardManagerUri), Http.request.schemaBody(ShardManagerProtocolHttp.Register_)({
        pod: Pod.make(podAddress, config.serverVersion)
      }));
      return yield* _(client(request));
    }).pipe(Effect.orDie),
    unregister: podAddress => Effect.gen(function* (_) {
      const request = yield* _(Http.request.post("/unregister"), Http.request.prependUrl(config.shardManagerUri), Http.request.schemaBody(ShardManagerProtocolHttp.Unregister_)({
        pod: Pod.make(podAddress, config.serverVersion)
      }));
      return yield* _(client(request));
    }).pipe(Effect.orDie),
    notifyUnhealthyPod: podAddress => Effect.gen(function* (_) {
      const request = yield* _(Http.request.post("/notify-unhealthy-pod"), Http.request.prependUrl(config.shardManagerUri), Http.request.schemaBody(ShardManagerProtocolHttp.NotifyUnhealthyPod_)({
        podAddress
      }));
      return yield* _(client(request));
    }).pipe(Effect.orDie),
    getAssignments: Effect.gen(function* (_) {
      const request = Http.request.prependUrl(config.shardManagerUri)(Http.request.get("/get-assignments"));
      const response = yield* _(client(request), Effect.flatMap(Http.response.schemaBodyJson(ShardManagerProtocolHttp.GetAssignmentsResult_)));
      return HashMap.fromIterable(response);
    }).pipe(Effect.orDie)
  };
})).pipe( /*#__PURE__*/Layer.use(Http.client.layer));
//# sourceMappingURL=ShardManagerClientHttp.mjs.map