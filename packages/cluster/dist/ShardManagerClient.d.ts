/**
 * @since 1.0.0
 */
import * as PodAddress from "@effect/cluster/PodAddress";
import * as ShardId from "@effect/cluster/ShardId";
import * as ShardingConfig from "@effect/cluster/ShardingConfig";
import { Tag } from "effect/Context";
import * as Effect from "effect/Effect";
import * as HashMap from "effect/HashMap";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
/**
 * @since 1.0.0
 * @category models
 */
export interface ShardManagerClient {
    readonly register: (podAddress: PodAddress.PodAddress) => Effect.Effect<never, never, void>;
    readonly unregister: (podAddress: PodAddress.PodAddress) => Effect.Effect<never, never, void>;
    readonly notifyUnhealthyPod: (podAddress: PodAddress.PodAddress) => Effect.Effect<never, never, void>;
    readonly getAssignments: Effect.Effect<never, never, HashMap.HashMap<ShardId.ShardId, Option.Option<PodAddress.PodAddress>>>;
}
/**
 * @since 1.0.0
 * @category context
 */
export declare const ShardManagerClient: Tag<ShardManagerClient, ShardManagerClient>;
/**
 * @since 1.0.0
 * @category layers
 */
export declare const local: Layer.Layer<ShardingConfig.ShardingConfig, never, ShardManagerClient>;
//# sourceMappingURL=ShardManagerClient.d.ts.map