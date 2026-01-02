import { Routes } from "discord.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { sendMessageDiscord } from "./send.js";

vi.mock("../web/media.js", () => ({
  loadWebMedia: vi.fn().mockResolvedValue({
    buffer: Buffer.from("img"),
    fileName: "photo.jpg",
    contentType: "image/jpeg",
    kind: "image",
  }),
}));

const makeRest = () => {
  const postMock = vi.fn();
  return {
    rest: {
      post: postMock,
    } as unknown as import("discord.js").REST,
    postMock,
  };
};

describe("sendMessageDiscord", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends basic channel messages", async () => {
    const { rest, postMock } = makeRest();
    postMock.mockResolvedValue({
      id: "msg1",
      channel_id: "789",
    });
    const res = await sendMessageDiscord("channel:789", "hello world", {
      rest,
      token: "t",
    });
    expect(res).toEqual({ messageId: "msg1", channelId: "789" });
    expect(postMock).toHaveBeenCalledWith(
      Routes.channelMessages("789"),
      expect.objectContaining({ body: { content: "hello world" } }),
    );
  });

  it("starts DM when recipient is a user", async () => {
    const { rest, postMock } = makeRest();
    postMock
      .mockResolvedValueOnce({ id: "chan1" })
      .mockResolvedValueOnce({ id: "msg1", channel_id: "chan1" });
    const res = await sendMessageDiscord("user:123", "hiya", {
      rest,
      token: "t",
    });
    expect(postMock).toHaveBeenNthCalledWith(
      1,
      Routes.userChannels(),
      expect.objectContaining({ body: { recipient_id: "123" } }),
    );
    expect(postMock).toHaveBeenNthCalledWith(
      2,
      Routes.channelMessages("chan1"),
      expect.objectContaining({ body: { content: "hiya" } }),
    );
    expect(res.channelId).toBe("chan1");
  });

  it("uploads media attachments", async () => {
    const { rest, postMock } = makeRest();
    postMock.mockResolvedValue({ id: "msg", channel_id: "789" });
    const res = await sendMessageDiscord("channel:789", "photo", {
      rest,
      token: "t",
      mediaUrl: "file:///tmp/photo.jpg",
    });
    expect(res.messageId).toBe("msg");
    expect(postMock).toHaveBeenCalledWith(
      Routes.channelMessages("789"),
      expect.objectContaining({
        files: [expect.objectContaining({ name: "photo.jpg" })],
      }),
    );
  });

  it("includes message_reference when replying", async () => {
    const { rest, postMock } = makeRest();
    postMock.mockResolvedValue({ id: "msg1", channel_id: "789" });
    await sendMessageDiscord("channel:789", "hello", {
      rest,
      token: "t",
      replyTo: "orig-123",
    });
    const body = postMock.mock.calls[0]?.[1]?.body;
    expect(body?.message_reference).toEqual({
      message_id: "orig-123",
      fail_if_not_exists: false,
    });
  });

  it("replies only on the first chunk", async () => {
    const { rest, postMock } = makeRest();
    postMock.mockResolvedValue({ id: "msg1", channel_id: "789" });
    await sendMessageDiscord("channel:789", "a".repeat(2001), {
      rest,
      token: "t",
      replyTo: "orig-123",
    });
    expect(postMock).toHaveBeenCalledTimes(2);
    const firstBody = postMock.mock.calls[0]?.[1]?.body;
    const secondBody = postMock.mock.calls[1]?.[1]?.body;
    expect(firstBody?.message_reference).toEqual({
      message_id: "orig-123",
      fail_if_not_exists: false,
    });
    expect(secondBody?.message_reference).toBeUndefined();
  });

  it("replies only on the first media send", async () => {
    const { rest, postMock } = makeRest();
    postMock.mockResolvedValue({ id: "msg1", channel_id: "789" });
    await sendMessageDiscord("channel:789", "b".repeat(2001), {
      rest,
      token: "t",
      mediaUrl: "file:///tmp/photo.jpg",
      replyTo: "orig-123",
    });
    expect(postMock).toHaveBeenCalledTimes(2);
    const firstBody = postMock.mock.calls[0]?.[1]?.body;
    const secondBody = postMock.mock.calls[1]?.[1]?.body;
    expect(firstBody?.message_reference).toEqual({
      message_id: "orig-123",
      fail_if_not_exists: false,
    });
    expect(secondBody?.message_reference).toBeUndefined();
  });
});
