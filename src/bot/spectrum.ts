// Spectrum (Photon) provider setup, the inbound message loop, and send helpers.
// Docs: https://photon.codes/docs/spectrum-ts/getting-started.md
import { Spectrum, attachment, type Message, type Space } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { terminal } from "spectrum-ts/providers/terminal";
import { config } from "../config";

type App = Awaited<ReturnType<typeof Spectrum>>;

let app: App | null = null;

// Spaces seen in the message loop, so replies don't need a lookup round trip.
const spaceCache = new Map<string, Space>();

async function createApp(): Promise<App> {
  if (config.spectrumProvider === "imessage") {
    return Spectrum({
      projectId: config.photonProjectId!,
      projectSecret: config.photonProjectSecret!,
      providers: [imessage.config()],
    });
  }
  return Spectrum({ providers: [terminal.config()] });
}

// Phase 1: echo. Command handling replaces this later.
async function handleMessage(space: Space, message: Message): Promise<void> {
  if (message.content.type !== "text") return;
  await space.send(message.content.text);
}

async function runLoop(current: App): Promise<void> {
  while (app === current) {
    try {
      for await (const [space, message] of current.messages) {
        if (message.direction === "outbound") continue;
        spaceCache.set(space.id, space);
        const text = message.content.type === "text" ? JSON.stringify(message.content.text) : `<${message.content.type}>`;
        console.log(`[photon] in space=${space.id} from=${message.sender?.id ?? "?"} ${text}`);
        try {
          await handleMessage(space, message);
        } catch (err) {
          console.error(`[photon] handler failed space=${space.id}:`, (err as Error).message);
        }
      }
      console.warn("[photon] message stream ended, restarting in 5s");
    } catch (err) {
      console.error("[photon] message loop crashed, restarting in 5s:", (err as Error).message);
    }
    await Bun.sleep(5000);
  }
}

// Never throws: if Photon is unreachable the rest of the app keeps running and sends become no-ops.
export async function startBot(): Promise<void> {
  try {
    app = await createApp();
    console.log(`[photon] connected provider=${config.spectrumProvider}`);
    void runLoop(app);
  } catch (err) {
    console.error(`[photon] failed to start provider=${config.spectrumProvider}:`, (err as Error).message);
    app = null;
  }
}

async function resolveSpace(spaceId: string): Promise<Space | null> {
  const cached = spaceCache.get(spaceId);
  if (cached) return cached;
  if (!app) return null;
  const space =
    config.spectrumProvider === "imessage"
      ? await imessage(app).space.get(spaceId)
      : await terminal(app).space.get(spaceId);
  spaceCache.set(spaceId, space);
  return space;
}

export async function sendToSpace(spaceId: string, text: string): Promise<boolean> {
  try {
    const space = await resolveSpace(spaceId);
    if (!space) {
      console.warn(`[photon] bot offline, dropped send to space=${spaceId}: ${JSON.stringify(text)}`);
      return false;
    }
    await space.send(text);
    console.log(`[photon] out space=${spaceId} ${JSON.stringify(text)}`);
    return true;
  } catch (err) {
    console.error(`[photon] send failed space=${spaceId}:`, (err as Error).message);
    return false;
  }
}

export async function sendImage(
  spaceId: string,
  buffer: Buffer,
  opts: { name?: string; mimeType?: string } = {},
): Promise<boolean> {
  const name = opts.name ?? "snitch.png";
  const mimeType = opts.mimeType ?? "image/png";
  try {
    const space = await resolveSpace(spaceId);
    if (!space) {
      console.warn(`[photon] bot offline, dropped image to space=${spaceId}`);
      return false;
    }
    await space.send(attachment(buffer, { name, mimeType }));
    console.log(`[photon] out space=${spaceId} <image ${name} ${buffer.length}b>`);
    return true;
  } catch (err) {
    console.error(`[photon] image send failed space=${spaceId}:`, (err as Error).message);
    return false;
  }
}
