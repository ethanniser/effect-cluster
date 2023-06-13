import { EntityType } from "./RecipientType";
import * as Schema from "@effect/schema/Schema";
import * as Message from "./Message";

export const [GetCurrent_, GetCurrent] = Message.schema(Schema.number)(
  Schema.struct({
    _tag: Schema.literal("GetCurrent"),
  })
);

export const CounterMsg = Schema.union(
  Schema.struct({
    _tag: Schema.literal("Increment"),
  }),
  Schema.struct({
    _tag: Schema.literal("Decrement"),
  }),
  GetCurrent_
);

export type CounterMsg = Schema.To<typeof CounterMsg>;

export const CounterEntity = EntityType("Counter", CounterMsg);
