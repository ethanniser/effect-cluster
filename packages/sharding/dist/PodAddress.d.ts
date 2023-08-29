/**
 * @since 1.0.0
 */
import * as Data from "@effect/data/Data";
import * as Schema from "@effect/schema/Schema";
/**
 * @since 1.0.0
 * @category symbols
 */
export declare const TypeId = "@effect/sharding/PodAddress";
/**
 * @since 1.0.0
 * @category symbols
 */
export type TypeId = typeof TypeId;
/**
 * @since 1.0.0
 * @category models
 */
export interface PodAddress extends Schema.To<typeof schema> {
}
/**
 * @since 1.0.0
 * @category utils
 */
export declare function isPodAddress(value: unknown): value is PodAddress;
/**
 * @since 1.0.0
 * @category constructors
 */
export declare function make(host: string, port: number): PodAddress;
/**
 * This is the schema for a value.
 *
 * @since 1.0.0
 * @category schema
 */
export declare const schema: Schema.Schema<{
    readonly _id: "@effect/sharding/PodAddress";
    readonly host: string;
    readonly port: number;
}, Data.Data<{
    readonly _id: "@effect/sharding/PodAddress";
    readonly host: string;
    readonly port: number;
}>>;
//# sourceMappingURL=PodAddress.d.ts.map