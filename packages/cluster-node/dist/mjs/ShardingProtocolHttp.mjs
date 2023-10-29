/**
 * @since 1.0.0
 */
import * as SerializedEnvelope from "@effect/cluster/SerializedEnvelope";
import * as SerializedMessage from "@effect/cluster/SerializedMessage";
import * as ShardId from "@effect/cluster/ShardId";
import * as ShardingError from "@effect/cluster/ShardingError";
import * as Schema from "@effect/schema/Schema";
/**
 * @since 1.0.0
 * @category schema
 */
export const AssignShard_ = /*#__PURE__*/Schema.struct({
  shards: /*#__PURE__*/Schema.array(ShardId.schema)
});
/**
 * @since 1.0.0
 * @category schema
 */
export const UnassignShards_ = /*#__PURE__*/Schema.struct({
  shards: /*#__PURE__*/Schema.array(ShardId.schema)
});
/**
 * @since 1.0.0
 * @category schema
 */
export const Send_ = /*#__PURE__*/Schema.struct({
  message: SerializedEnvelope.schema
});
/**
 * @since 1.0.0
 * @category schema
 */
export const SendResult_ = /*#__PURE__*/Schema.either(ShardingError.schema, /*#__PURE__*/Schema.option(SerializedMessage.schema));
/**
 * @since 1.0.0
 * @category schema
 */
export const PingShards_ = /*#__PURE__*/Schema.struct({});
/**
 * This is the schema for the protocol.
 *
 * @since 1.0.0
 * @category schema
 */
export const schema = /*#__PURE__*/Schema.union(AssignShard_, UnassignShards_, Send_, PingShards_);
//# sourceMappingURL=ShardingProtocolHttp.mjs.map