/**
 * @since 1.0.0
 */
import * as Data from "@effect/data/Data";
import * as Schema from "@effect/schema/Schema";
/**
 * @since 1.0.0
 * @category symbols
 */
export declare const ShardingEntityNotManagedByThisPodErrorTag: "@effect/sharding/ShardingEntityNotManagedByThisPodError";
declare const ShardingEntityNotManagedByThisPodErrorSchema_: Schema.Schema<{
    readonly entityId: string;
    readonly _tag: "@effect/sharding/ShardingEntityNotManagedByThisPodError";
}, Data.Data<{
    readonly entityId: string;
    readonly _tag: "@effect/sharding/ShardingEntityNotManagedByThisPodError";
}>>;
/**
 * @since 1.0.0
 * @category models
 */
export interface ShardingEntityNotManagedByThisPodError extends Schema.To<typeof ShardingEntityNotManagedByThisPodErrorSchema_> {
}
/**
 * @since 1.0.0
 * @category constructors
 */
export declare function ShardingEntityNotManagedByThisPodError(entityId: string): ShardingEntityNotManagedByThisPodError;
/**
 * @since 1.0.0
 * @category utils
 */
export declare function isShardingEntityNotManagedByThisPodError(value: any): value is ShardingEntityNotManagedByThisPodError;
/**
 * @since 1.0.0
 * @category schema
 */
export declare const ShardingEntityNotManagedByThisPodErrorSchema: Schema.Schema<Schema.From<typeof ShardingEntityNotManagedByThisPodErrorSchema_>, ShardingEntityNotManagedByThisPodError>;
export {};
//# sourceMappingURL=ShardingEntityNotManagedByThisPodError.d.ts.map