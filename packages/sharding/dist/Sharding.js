"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.Sharding = void 0;
exports.broadcaster = broadcaster;
exports.getPods = void 0;
exports.messenger = messenger;
exports.register = void 0;
exports.registerEntity = registerEntity;
exports.registerScoped = void 0;
exports.registerSingleton = registerSingleton;
exports.registerTopic = registerTopic;
exports.unregister = void 0;
var _Context = /*#__PURE__*/require("@effect/data/Context");
var Effect = /*#__PURE__*/_interopRequireWildcard( /*#__PURE__*/require("@effect/io/Effect"));
function _getRequireWildcardCache(nodeInterop) { if (typeof WeakMap !== "function") return null; var cacheBabelInterop = new WeakMap(); var cacheNodeInterop = new WeakMap(); return (_getRequireWildcardCache = function (nodeInterop) { return nodeInterop ? cacheNodeInterop : cacheBabelInterop; })(nodeInterop); }
function _interopRequireWildcard(obj, nodeInterop) { if (!nodeInterop && obj && obj.__esModule) { return obj; } if (obj === null || typeof obj !== "object" && typeof obj !== "function") { return { default: obj }; } var cache = _getRequireWildcardCache(nodeInterop); if (cache && cache.has(obj)) { return cache.get(obj); } var newObj = {}; var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var key in obj) { if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) { var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null; if (desc && (desc.get || desc.set)) { Object.defineProperty(newObj, key, desc); } else { newObj[key] = obj[key]; } } } newObj.default = obj; if (cache) { cache.set(obj, newObj); } return newObj; }
/**
 * @since 1.0.0
 */

/**
 * @since 1.0.0
 * @category context
 */
const Sharding = /*#__PURE__*/(0, _Context.Tag)();
/**
 * Notify the shard manager that shards can now be assigned to this pod.
 * @since 1.0.0
 * @category utils
 */
exports.Sharding = Sharding;
const register = /*#__PURE__*/Effect.flatMap(Sharding, _ => _.register);
/**
 * Notify the shard manager that shards must be unassigned from this pod.
 * @since 1.0.0
 * @category utils
 */
exports.register = register;
const unregister = /*#__PURE__*/Effect.flatMap(Sharding, _ => _.unregister);
/**
 * Same as `register`, but will automatically call `unregister` when the `Scope` is terminated.
 * @since 1.0.0
 * @category utils
 */
exports.unregister = unregister;
const registerScoped = /*#__PURE__*/Effect.zipRight(Effect.addFinalizer(() => unregister))(register);
/**
 * Start a computation that is guaranteed to run only on a single pod.
 * Each pod should call `registerSingleton` but only a single pod will actually run it at any given time.
 * @since 1.0.0
 * @category utils
 */
exports.registerScoped = registerScoped;
function registerSingleton(name, run) {
  return Effect.flatMap(Sharding, _ => _.registerSingleton(name, run));
}
/**
 * Register a new entity type, allowing pods to send messages to entities of this type.
 * It takes a `behavior` which is a function from an entity ID and a queue of messages to a ZIO computation that runs forever and consumes those messages.
 * You can use `ZIO.interrupt` from the behavior to stop it (it will be restarted the next time the entity receives a message).
 * If entity goes to idle timeout, it will be interrupted from outside.
 * @since 1.0.0
 * @category utils
 */
function registerEntity(entityType, behavior, options) {
  return Effect.flatMap(Sharding, _ => _.registerEntity(entityType, behavior, options));
}
/**
 * Register a new topic type, allowing pods to broadcast messages to subscribers.
 * It takes a `behavior` which is a function from a topic and a queue of messages to a ZIO computation that runs forever and consumes those messages.
 * You can use `ZIO.interrupt` from the behavior to stop it (it will be restarted the next time the topic receives a message).
 * If entity goes to idle timeout, it will be interrupted from outside.
 * @since 1.0.0
 * @category utils
 */
function registerTopic(topicType, behavior, options) {
  return Effect.flatMap(Sharding, _ => _.registerTopic(topicType, behavior, options));
}
/**
 * Get an object that allows sending messages to a given entity type.
 * You can provide a custom send timeout to override the one globally defined.
 * @since 1.0.0
 * @category utils
 */
function messenger(entityType, sendTimeout) {
  return Effect.map(Sharding, _ => _.messenger(entityType, sendTimeout));
}
/**
 * Get an object that allows broadcasting messages to a given topic type.
 * You can provide a custom send timeout to override the one globally defined.
 * @since 1.0.0
 * @category utils
 */
function broadcaster(topicType, sendTimeout) {
  return Effect.map(Sharding, _ => _.broadcaster(topicType, sendTimeout));
}
/**
 * Get the list of pods currently registered to the Shard Manager
 * @since 1.0.0
 * @category utils
 */
const getPods = /*#__PURE__*/Effect.flatMap(Sharding, _ => _.getPods);
exports.getPods = getPods;
//# sourceMappingURL=Sharding.js.map