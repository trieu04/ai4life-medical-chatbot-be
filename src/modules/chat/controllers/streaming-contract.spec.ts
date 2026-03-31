jest.mock("../../auth/guards/jwt-auth.guard", () => ({
  JwtAuthGuard: class JwtAuthGuardMock {},
}));

import { ChatController } from "./chat.controller";
import { GuestChatController } from "./guest-chat.controller";

describe("chat streaming contract", () => {
  it("forwards conversation, trace, and text payloads from startConversationStream", async () => {
    const controller = new ChatController({} as any, {
      sendFirstMessageStreaming: jest.fn().mockResolvedValue({
        conversation: { id: "conversation-1" },
        stream: (async function* () {
          yield { type: "trace", trace: "Routing: analyzing intent" };
          yield { type: "text", text: "Final answer" };
        })(),
      }),
    } as any);

    const events = await controller.startConversationStream(
      "user-1",
      { role: "admin" } as any,
      { content: "Hello" } as any,
    );
    const values = await new Promise<Array<{ data: string }>>((resolve, reject) => {
      const emitted: Array<{ data: string }> = [];
      events.subscribe({
        next: (value) => emitted.push(value),
        error: reject,
        complete: () => resolve(emitted),
      });
    });

    expect(values).toEqual([
      { data: JSON.stringify({ type: "conversation", conversationId: "conversation-1" }) },
      { data: JSON.stringify({ type: "trace", trace: "Routing: analyzing intent" }) },
      { data: JSON.stringify({ type: "text", text: "Final answer" }) },
    ]);
  });

  it("forwards trace and text payloads from guest streams without flattening trace into text", async () => {
    const aiService = {
      generateResponse: jest.fn().mockResolvedValue({
        stream: (async function* () {
          yield { type: "trace", trace: "Routing: analyzing intent" };
          yield { type: "text", text: "Final answer" };
        })(),
      }),
    };

    const controller = new GuestChatController(aiService as any);
    const events = await controller.guestStream({ content: "Hello" } as any);
    const values = await new Promise<Array<{ data: string }>>((resolve, reject) => {
      const emitted: Array<{ data: string }> = [];
      events.subscribe({
        next: (value) => emitted.push(value),
        error: reject,
        complete: () => resolve(emitted),
      });
    });

    expect(values).toEqual([
      { data: JSON.stringify({ type: "trace", trace: "Routing: analyzing intent" }) },
      { data: JSON.stringify({ type: "text", text: "Final answer" }) },
    ]);
  });
});
