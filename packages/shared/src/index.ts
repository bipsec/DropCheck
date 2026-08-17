// @dropcheck/shared — the wire surface between apps/api and apps/web.
//
// Nothing in here may import a runtime dependency. Both a Node server
// and a browser bundle consume this package, so it stays types-only.

export * from "./api-types";
export * from "./chat-events";
