/**
 * @since 1.0.0
 */
import * as Schema from "@effect/schema/Schema";
/**
 * @since 1.0.0
 * @category schema
 */
export declare const Register_: Schema.Schema<{
    readonly pod: {
        readonly _id: "@effect/sharding/Pod";
        readonly address: {
            readonly _id: "@effect/sharding/PodAddress";
            readonly host: string;
            readonly port: number;
        };
        readonly version: string;
    };
}, {
    readonly pod: import("@effect/data/Data").Data<{
        readonly _id: "@effect/sharding/Pod";
        readonly address: import("@effect/data/Data").Data<{
            readonly _id: "@effect/sharding/PodAddress";
            readonly host: string;
            readonly port: number;
        }>;
        readonly version: string;
    }>;
}>;
/**
 * @since 1.0.0
 * @category schema
 */
export declare const Unregister_: Schema.Schema<{
    readonly pod: {
        readonly _id: "@effect/sharding/Pod";
        readonly address: {
            readonly _id: "@effect/sharding/PodAddress";
            readonly host: string;
            readonly port: number;
        };
        readonly version: string;
    };
}, {
    readonly pod: import("@effect/data/Data").Data<{
        readonly _id: "@effect/sharding/Pod";
        readonly address: import("@effect/data/Data").Data<{
            readonly _id: "@effect/sharding/PodAddress";
            readonly host: string;
            readonly port: number;
        }>;
        readonly version: string;
    }>;
}>;
/**
 * @since 1.0.0
 * @category schema
 */
export declare const NotifyUnhealthyPod_: Schema.Schema<{
    readonly podAddress: {
        readonly _id: "@effect/sharding/PodAddress";
        readonly host: string;
        readonly port: number;
    };
}, {
    readonly podAddress: import("@effect/data/Data").Data<{
        readonly _id: "@effect/sharding/PodAddress";
        readonly host: string;
        readonly port: number;
    }>;
}>;
/**
 * @since 1.0.0
 * @category schema
 */
export declare const GetAssignmentsResult_: Schema.Schema<readonly (readonly [{
    readonly _id: "@effect/sharding/ShardId";
    readonly value: number;
}, {
    readonly _tag: "None";
} | {
    readonly _tag: "Some";
    readonly value: {
        readonly _id: "@effect/sharding/PodAddress";
        readonly host: string;
        readonly port: number;
    };
}])[], readonly (readonly [import("@effect/data/Data").Data<{
    readonly _id: "@effect/sharding/ShardId";
    readonly value: number;
}>, import("@effect/data/Option").Option<import("@effect/data/Data").Data<{
    readonly _id: "@effect/sharding/PodAddress";
    readonly host: string;
    readonly port: number;
}>>])[]>;
//# sourceMappingURL=ShardManagerProtocolHttp.d.ts.map