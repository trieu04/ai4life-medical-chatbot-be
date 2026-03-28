import { MessageService } from "./message.service";
import { MessageRole } from "../entities/message.entity";

describe("MessageService", () => {
  it("persists deduped thinking metadata without mixing trace into assistant content", async () => {
    const save = jest.fn(async (entity) => entity);
    const create = jest.fn((payload) => payload);

    const service = new MessageService(
      {
        create,
        save,
      } as any,
      {} as any,
      {
        generateResponse: jest.fn().mockResolvedValue({
          stream: (async function* () {
            yield { type: "trace", trace: "Routing: analyzing intent" };
            yield { type: "trace", trace: "Routing: analyzing intent" };
            yield { type: "text", text: "Final answer" };
            yield { type: "trace", trace: "Retrieval: searching references" };
          })(),
        }),
        countTokens: jest.fn().mockReturnValue(3),
      } as any,
      {
        getConversationById: jest.fn().mockResolvedValue({ maxTokens: 1000 }),
        getRecentMessagesForContext: jest.fn().mockResolvedValue([]),
        updateConversationTokens: jest.fn().mockResolvedValue(undefined),
      } as any,
    );

    const result = await service.sendMessageStreaming(
      "conversation-1",
      "user-1",
      { content: "Hello" } as any,
    );

    for await (const _chunk of result.stream) {
      // consume stream fully so persistence runs
    }

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conversation-1",
        role: MessageRole.ASSISTANT,
        content: "Final answer",
        metadata: {
          thinking: [
            "Routing: analyzing intent",
            "Retrieval: searching references",
          ],
        },
      }),
    );
    expect(save).toHaveBeenCalledTimes(2);
  });
});
