import * as Chunk from "@effect/data/Chunk"
import { Tag } from "@effect/data/Context"
import * as Duration from "@effect/data/Duration"
import { equals } from "@effect/data/Equal"
import { pipe } from "@effect/data/Function"
import * as HashMap from "@effect/data/HashMap"
import * as Option from "@effect/data/Option"
import * as Cause from "@effect/io/Cause"
import * as Deferred from "@effect/io/Deferred"
import * as Effect from "@effect/io/Effect"
import * as Exit from "@effect/io/Exit"
import * as Layer from "@effect/io/Layer"
import * as Logger from "@effect/io/Logger"
import * as LogLevel from "@effect/io/Logger/Level"
import * as Queue from "@effect/io/Queue"
import * as Ref from "@effect/io/Ref"
import * as Schema from "@effect/schema/Schema"
import * as Message from "@effect/shardcake/Message"
import * as Pods from "@effect/shardcake/Pods"
import * as PodsHealth from "@effect/shardcake/PodsHealth"
import * as PoisonPill from "@effect/shardcake/PoisonPill"
import * as RecipientBehaviour from "@effect/shardcake/RecipientBehaviour"
import * as RecipientType from "@effect/shardcake/RecipientType"
import * as Serialization from "@effect/shardcake/Serialization"
import { isEntityTypeNotRegistered } from "@effect/shardcake/ShardError"
import * as Sharding from "@effect/shardcake/Sharding"
import * as ShardingConfig from "@effect/shardcake/ShardingConfig"
import * as ShardingImpl from "@effect/shardcake/ShardingImpl"
import * as ShardManagerClient from "@effect/shardcake/ShardManagerClient"
import * as Storage from "@effect/shardcake/Storage"
import * as StreamMessage from "@effect/shardcake/StreamMessage"
import { assertTrue } from "@effect/shardcake/test/util"
import * as Stream from "@effect/stream/Stream"

interface SampleService {
  value: number
}

const SampleService = Tag<SampleService>()

describe.concurrent("SampleTests", () => {
  const inMemorySharding = pipe(
    ShardingImpl.live,
    Layer.use(PodsHealth.local),
    Layer.use(Pods.noop),
    Layer.use(Storage.memory),
    Layer.use(Serialization.json),
    Layer.use(ShardManagerClient.local),
    Layer.use(
      ShardingConfig.withDefaults({ simulateRemotePods: true, entityTerminationTimeout: Duration.millis(3000) })
    )
  )

  const withTestEnv = <R, E, A>(fa: Effect.Effect<R, E, A>) =>
    pipe(fa, Effect.provideSomeLayer(inMemorySharding), Effect.scoped, Logger.withMinimumLogLevel(LogLevel.Error))

  it("Succefully delivers a message", () => {
    return Effect.gen(function*(_) {
      yield* _(Sharding.registerScoped)
      const received = yield* _(Ref.make(false))

      const SampleEntity = RecipientType.makeEntityType("Sample", Schema.number)
      const behavior = RecipientBehaviour.dequeue(
        SampleEntity.schema,
        (_, queue) => pipe(PoisonPill.takeOrInterrupt(queue), Effect.zipRight(Ref.set(received, true)))
      )
      yield* _(
        Sharding.registerEntity(
          SampleEntity,
          behavior
        )
      )

      const messenger = yield* _(Sharding.messenger(SampleEntity))
      yield* _(messenger.sendDiscard("entity1")(1))

      assertTrue(yield* _(Ref.get(received)))
    }).pipe(withTestEnv, Effect.runPromise)
  })

  it("Fails with if entity not registered", () => {
    return Effect.gen(function*(_) {
      yield* _(Sharding.registerScoped)
      const SampleEntity = RecipientType.makeEntityType("Sample", Schema.number)

      const messenger = yield* _(Sharding.messenger(SampleEntity))
      const exit = yield* _(messenger.sendDiscard("entity1")(1).pipe(Effect.exit))

      assertTrue(Exit.isFailure(exit))

      if (Exit.isFailure(exit)) {
        const error = Cause.failureOption(exit.cause)
        assertTrue(Option.isSome(error))
        if (Option.isSome(error)) {
          assertTrue(isEntityTypeNotRegistered(error.value))
        }
      }
    }).pipe(withTestEnv, Effect.runPromise)
  })

  it("Succefully delivers a message to the correct entity", () => {
    return Effect.gen(function*(_) {
      yield* _(Sharding.registerScoped)
      const result1 = yield* _(Ref.make(0))
      const result2 = yield* _(Ref.make(0))

      const SampleEntity = RecipientType.makeEntityType("Sample", Schema.number)
      const behavior = RecipientBehaviour.dequeue(SampleEntity.schema, (entityId, queue) =>
        pipe(
          PoisonPill.takeOrInterrupt(queue),
          Effect.flatMap((msg) => Ref.set(entityId === "entity1" ? result1 : result2, msg))
        ))

      yield* _(Sharding.registerEntity(SampleEntity, behavior))

      const messenger = yield* _(Sharding.messenger(SampleEntity))
      yield* _(messenger.sendDiscard("entity1")(1))
      yield* _(messenger.sendDiscard("entity2")(2))

      assertTrue(1 === (yield* _(Ref.get(result1))))
      assertTrue(2 === (yield* _(Ref.get(result2))))
    }).pipe(withTestEnv, Effect.runPromise)
  })

  it("Succefully delivers a message with a reply to an entity", () => {
    return Effect.gen(function*(_) {
      yield* _(Sharding.registerScoped)
      const [SampleMessage_, SampleMessage] = Message.schema(Schema.number)(Schema.struct({
        _tag: Schema.literal("SampleMessage")
      }))

      const SampleProtocol = Schema.union(SampleMessage_)

      const SampleEntity = RecipientType.makeEntityType("Sample", SampleProtocol)
      const behavior = RecipientBehaviour.dequeue(SampleEntity.schema, (entityId, queue) =>
        pipe(
          PoisonPill.takeOrInterrupt(queue),
          Effect.flatMap((msg) => msg.replier.reply(42))
        ))

      yield* _(Sharding.registerEntity(SampleEntity, behavior))

      const messenger = yield* _(Sharding.messenger(SampleEntity))
      const result = yield* _(messenger.send("entity1")(SampleMessage({ _tag: "SampleMessage" })))

      assertTrue(result === 42)
    }).pipe(withTestEnv, Effect.runPromise)
  })

  it("Succefully broadcasts a message", () => {
    return Effect.gen(function*(_) {
      yield* _(Sharding.registerScoped)
      const [GetIncrement_, GetIncrement] = Message.schema(Schema.number)(Schema.struct({
        _tag: Schema.literal("GetIncrement")
      }))

      const SampleProtocol = Schema.union(
        Schema.struct({
          _tag: Schema.literal("BroadcastIncrement")
        }),
        GetIncrement_
      )

      const SampleTopic = RecipientType.makeTopicType("Sample", SampleProtocol)
      const behavior = RecipientBehaviour.dequeue(
        SampleTopic.schema,
        (entityId, queue) =>
          Effect.flatMap(Ref.make(0), (ref) =>
            pipe(
              PoisonPill.takeOrInterrupt(queue),
              Effect.flatMap((msg) => {
                switch (msg._tag) {
                  case "BroadcastIncrement":
                    return Ref.update(ref, (_) => _ + 1)
                  case "GetIncrement":
                    return Effect.flatMap(Ref.get(ref), (_) => msg.replier.reply(_))
                }
              }),
              Effect.forever
            ))
      )
      yield* _(Sharding.registerTopic(SampleTopic, behavior))

      const broadcaster = yield* _(Sharding.broadcaster(SampleTopic))
      yield* _(broadcaster.broadcastDiscard("c1")({ _tag: "BroadcastIncrement" }))
      yield* _(Effect.sleep(Duration.seconds(2)))

      const c1 = yield* _(broadcaster.broadcast("c1")(GetIncrement({ _tag: "GetIncrement" })))

      assertTrue(1 === HashMap.size(c1)) // Here we have just one pod, so there will be just one incrementer
    }).pipe(withTestEnv, Effect.runPromise)
  })

  it("Succefully delivers a message with a streaming reply to an entity", () => {
    return Effect.gen(function*(_) {
      yield* _(Sharding.registerScoped)
      const [SampleMessage_, SampleMessage] = StreamMessage.schema(Schema.number)(Schema.struct({
        _tag: Schema.literal("SampleMessage")
      }))

      const SampleProtocol = Schema.union(SampleMessage_)

      const SampleEntity = RecipientType.makeEntityType("Sample", SampleProtocol)
      const behavior = RecipientBehaviour.dequeue(SampleEntity.schema, (entityId, queue) =>
        pipe(
          PoisonPill.takeOrInterrupt(queue),
          Effect.flatMap((msg) => msg.replier.reply(Stream.fromIterable([1, 2, 3]))),
          Effect.forever
        ))
      yield* _(Sharding.registerEntity(SampleEntity, behavior))

      const messenger = yield* _(Sharding.messenger(SampleEntity))
      const stream = yield* _(messenger.sendStream("entity1")(SampleMessage({ _tag: "SampleMessage" })))
      const result = yield* _(Stream.runCollect(stream))

      assertTrue(equals(result, Chunk.fromIterable([1, 2, 3])))
    }).pipe(withTestEnv, Effect.runPromise)
  })

  it("When the messenger interrupts, the stream on the entity should too", () => {
    return Effect.gen(function*(_) {
      yield* _(Sharding.registerScoped)
      const exit = yield* _(Deferred.make<never, boolean>())
      const [SampleMessage_, SampleMessage] = StreamMessage.schema(Schema.number)(Schema.struct({
        _tag: Schema.literal("SampleMessage")
      }))

      const SampleProtocol = Schema.union(
        SampleMessage_
      )

      const SampleEntity = RecipientType.makeEntityType("Sample", SampleProtocol)
      const behavior = RecipientBehaviour.dequeue(SampleEntity.schema, (entityId, queue) =>
        pipe(
          PoisonPill.takeOrInterrupt(queue),
          Effect.flatMap((msg) =>
            msg.replier.reply(pipe(
              Stream.never,
              Stream.ensuring(Deferred.succeed(exit, true)), // <- signal interruption on shard side
              Stream.map(() => 42)
            ))
          ),
          Effect.forever
        ))

      yield* _(Sharding.registerEntity(SampleEntity, behavior))

      const messenger = yield* _(Sharding.messenger(SampleEntity))
      const stream = yield* _(messenger.sendStream("entity1")(SampleMessage({ _tag: "SampleMessage" })))
      yield* _(
        Stream.runDrain(stream.pipe(
          Stream.interruptAfter(Duration.millis(500)) // <- interrupts after a while
        ))
      )

      yield* _(Deferred.await(exit)) // <- hangs if not working
      assertTrue(true)
    }).pipe(withTestEnv, Effect.runPromise)
  })

  it("When the stream on entity interrupts, the stream on the messenger should close", () => {
    return Effect.gen(function*(_) {
      yield* _(Sharding.registerScoped)
      const exit = yield* _(Deferred.make<never, boolean>())
      const [SampleMessage_, SampleMessage] = StreamMessage.schema(Schema.number)(Schema.struct({
        _tag: Schema.literal("SampleMessage")
      }))

      const SampleProtocol = Schema.union(SampleMessage_)

      const SampleEntity = RecipientType.makeEntityType("Sample", SampleProtocol)
      const behavior = RecipientBehaviour.dequeue(SampleEntity.schema, (entityId, queue) =>
        pipe(
          PoisonPill.takeOrInterrupt(queue),
          Effect.flatMap((msg) =>
            msg.replier.reply(pipe(
              Stream.never,
              Stream.ensuring(Deferred.succeed(exit, true)), // <- signal interruption on shard side
              Stream.interruptAfter(Duration.millis(500))
            ))
          ),
          Effect.forever
        ))

      yield* _(Sharding.registerEntity(SampleEntity, behavior))

      const messenger = yield* _(Sharding.messenger(SampleEntity))
      const stream = yield* _(messenger.sendStream("entity1")(SampleMessage({ _tag: "SampleMessage" })))
      const result = yield* _(
        Stream.runCollect(stream)
      )

      assertTrue(yield* _(Deferred.await(exit)))
      assertTrue(Chunk.size(result) === 0)
    }).pipe(withTestEnv, Effect.runPromise)
  })

  it("Behaviour is interrupted if shard is terminated", () => {
    let entityInterrupted = false

    return Effect.gen(function*(_) {
      yield* _(Sharding.registerScoped)
      const entityStarted = yield* _(Deferred.make<never, boolean>())

      const SampleProtocol = Schema.union(
        Schema.struct({
          _tag: Schema.literal("Awake")
        })
      )
      const SampleEntity = RecipientType.makeEntityType("Sample", SampleProtocol)
      const behavior = RecipientBehaviour.dequeue(SampleEntity.schema, (entityId, queue) =>
        pipe(
          Queue.take(queue),
          Effect.flatMap((msg) => {
            if (PoisonPill.isPoisonPill(msg)) {
              return pipe(
                Effect.sync(() => {
                  entityInterrupted = true
                }),
                Effect.zipRight(Effect.interrupt)
              )
            }
            switch (msg._tag) {
              case "Awake":
                return Deferred.succeed(entityStarted, true)
            }
          }),
          Effect.forever
        ))

      yield* _(Sharding.registerEntity(
        SampleEntity,
        behavior,
        Option.some(Duration.minutes(10))
      ))

      const messenger = yield* _(Sharding.messenger(SampleEntity))
      yield* _(messenger.sendDiscard("entity1")({ _tag: "Awake" }))
      yield* _(Deferred.await(entityStarted))
    }).pipe(withTestEnv, Effect.runPromise).then(() => assertTrue(entityInterrupted))
  })

  it("Ensure graceful shutdown is completed if shard is terminated", () => {
    let shutdownCompleted = false

    return Effect.gen(function*(_) {
      yield* _(Sharding.registerScoped)
      const entityStarted = yield* _(Deferred.make<never, boolean>())

      const SampleProtocol = Schema.struct({
        _tag: Schema.literal("Awake")
      })

      const SampleEntity = RecipientType.makeEntityType("Sample", SampleProtocol)
      const behavior = RecipientBehaviour.dequeue(SampleEntity.schema, (entityId, queue) =>
        pipe(
          Queue.take(queue),
          Effect.flatMap((msg) => {
            if (PoisonPill.isPoisonPill(msg)) {
              return pipe(
                Effect.sleep(Duration.seconds(3)),
                Effect.zipRight(Effect.logDebug("Shutting down...")),
                Effect.zipRight(
                  Effect.sync(() => {
                    shutdownCompleted = true
                  })
                ),
                Effect.flatMap(() => Effect.interrupt)
              )
            }
            return Deferred.succeed(entityStarted, true)
          }),
          Effect.forever
        ))

      yield* _(Sharding.registerEntity(
        SampleEntity,
        behavior,
        Option.some(Duration.minutes(10))
      ))

      const messenger = yield* _(Sharding.messenger(SampleEntity))
      yield* _(messenger.sendDiscard("entity1")({ _tag: "Awake" }))
      yield* _(Deferred.await(entityStarted))
    }).pipe(withTestEnv, Effect.runPromise).then(() => assertTrue(shutdownCompleted))
  })

  it("Ensure graceful shutdown is completed if entity terminates, and then shard is terminated too", () => {
    let shutdownCompleted = false

    return Effect.gen(function*(_) {
      yield* _(Sharding.registerScoped)
      const shutdownReceived = yield* _(Deferred.make<never, boolean>())

      const SampleProtocol = Schema.union(
        Schema.struct({
          _tag: Schema.literal("Awake")
        })
      )
      const SampleEntity = RecipientType.makeEntityType("Sample", SampleProtocol)
      const behavior = RecipientBehaviour.dequeue(SampleEntity.schema, (entityId, queue) =>
        pipe(
          Queue.take(queue),
          Effect.flatMap((msg) => {
            if (PoisonPill.isPoisonPill(msg)) {
              return pipe(
                Deferred.succeed(shutdownReceived, true),
                Effect.zipRight(Effect.sleep(Duration.seconds(3))),
                Effect.zipRight(Effect.sync(() => {
                  shutdownCompleted = true
                })),
                Effect.flatMap(() => Effect.interrupt)
              )
            }
            switch (msg._tag) {
              case "Awake":
                return Effect.unit
            }
          }),
          Effect.forever
        ))

      yield* _(Sharding.registerEntity(
        SampleEntity,
        behavior,
        Option.some(Duration.millis(100))
      ))

      const messenger = yield* _(Sharding.messenger(SampleEntity))
      yield* _(messenger.sendDiscard("entity1")({ _tag: "Awake" }))
      yield* _(Deferred.await(shutdownReceived))
    }).pipe(withTestEnv, Effect.runPromise).then(() => assertTrue(shutdownCompleted))
  })

  it("Behaviour accept gets called before putting message in the queue", () => {
    return Effect.gen(function*(_) {
      yield* _(Sharding.registerScoped)
      const called = yield* _(Ref.make(false))
      const received = yield* _(Ref.make(false))

      const SampleEntity = RecipientType.makeEntityType("Sample", Schema.number)
      const behavior = pipe(
        RecipientBehaviour.process(
          SampleEntity.schema,
          () => Ref.set(received, true)
        ),
        RecipientBehaviour.onReceive(() => Ref.set(called, true))
      )
      yield* _(
        Sharding.registerEntity(
          SampleEntity,
          behavior
        )
      )

      const messenger = yield* _(Sharding.messenger(SampleEntity))
      yield* _(messenger.sendDiscard("entity1")(1))

      assertTrue(yield* _(Ref.get(called)))
      assertTrue(yield* _(Ref.get(received)))
    }).pipe(withTestEnv, Effect.runPromise)
  })

  it("Behaviour accept composes well next() call", () => {
    return Effect.gen(function*(_) {
      yield* _(Sharding.registerScoped)
      const called = yield* _(Ref.make(false))
      const calledNext = yield* _(Ref.make(false))
      const received = yield* _(Ref.make(false))

      const SampleEntity = RecipientType.makeEntityType("Sample", Schema.number)
      const behavior = pipe(
        RecipientBehaviour.process(
          SampleEntity.schema,
          () => Ref.set(received, true)
        ),
        RecipientBehaviour.onReceive(() =>
          pipe(
            SampleService,
            Effect.zipRight(Ref.set(calledNext, true))
          )
        ),
        RecipientBehaviour.onReceive((entityId, msg, next) =>
          pipe(
            Ref.set(called, true),
            Effect.zipRight(next)
          )
        )
      )
      yield* _(
        Sharding.registerEntity(
          SampleEntity,
          behavior
        )
      )

      const messenger = yield* _(Sharding.messenger(SampleEntity))
      yield* _(messenger.sendDiscard("entity1")(1))

      assertTrue(yield* _(Ref.get(called)))
      assertTrue(yield* _(Ref.get(calledNext)))
      assertTrue(yield* _(Ref.get(received)))
    }).pipe(withTestEnv, Effect.provideService(SampleService, { value: 42 }), Effect.runPromise)
  })

  it("Singletons should start", () => {
    return Effect.gen(function*(_) {
      yield* _(Sharding.registerScoped)
      const received = yield* _(Deferred.make<never, boolean>())

      yield* _(
        Sharding.registerSingleton(
          "sample",
          Deferred.succeed(received, true)
        )
      )

      assertTrue(yield* _(Deferred.await(received)))
    }).pipe(
      Effect.provideSomeLayer(inMemorySharding),
      Effect.scoped,
      Effect.runPromise
    )
  })

  it("Singletons should be interrupted upon sharding stop", () => {
    return Effect.gen(function*(_) {
      yield* _(Sharding.registerScoped)
      const received = yield* _(Deferred.make<never, boolean>())

      yield* _(
        Sharding.registerSingleton(
          "sample",
          pipe(
            Deferred.succeed(received, true),
            Effect.zipRight(Effect.never)
          )
        )
      )

      assertTrue(yield* _(Deferred.await(received)))
    }).pipe(
      Effect.provideSomeLayer(inMemorySharding),
      Effect.scoped,
      Effect.runPromise
    )
  })
})
