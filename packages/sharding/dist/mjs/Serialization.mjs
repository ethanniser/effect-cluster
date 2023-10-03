/**
 * @since 1.0.0
 */
import * as Schema from "@effect/schema/Schema";
import * as TreeFormatter from "@effect/schema/TreeFormatter";
import * as ByteArray from "@effect/sharding/ByteArray";
import * as ShardingError from "@effect/sharding/ShardingError";
import { Tag } from "effect/Context";
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import * as Layer from "effect/Layer";
/** @internal */
function jsonStringify(value, schema) {
  return pipe(value, Schema.encode(schema), Effect.mapError(e => ShardingError.ShardingErrorSerialization(TreeFormatter.formatErrors(e.errors))), Effect.map(_ => JSON.stringify(_)));
}
/** @internal */
function jsonParse(value, schema) {
  return pipe(Effect.sync(() => JSON.parse(value)), Effect.flatMap(Schema.decode(schema)), Effect.mapError(e => ShardingError.ShardingErrorSerialization(TreeFormatter.formatErrors(e.errors))));
}
/**
 * @since 1.0.0
 * @category symbols
 */
export const TypeId = /*#__PURE__*/Symbol.for("@effect/sharding/SerializationTypeId");
/**
 * @since 1.0.0
 * @category context
 */
export const Serialization = /*#__PURE__*/Tag();
/**
 * A layer that uses Java serialization for encoding and decoding messages.
 * This is useful for testing and not recommended to use in production.
 * @since 1.0.0
 * @category layers
 */
export const json = /*#__PURE__*/Layer.succeed(Serialization, {
  _id: TypeId,
  encode: (message, schema) => pipe(jsonStringify(message, schema), Effect.map(ByteArray.make)),
  decode: (body, schema) => jsonParse(body.value, schema)
});
//# sourceMappingURL=Serialization.mjs.map