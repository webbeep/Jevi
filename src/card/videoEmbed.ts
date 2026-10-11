/** A YouTube or Vimeo watch page that can play inline. Channels and other links cannot. */
export type VideoEmbed = {
  id: string;
  /**
   * Player with autoplay left off. A frame that is already on the page must not
   * start while the poster is still covering it.
   */
  player: string;
  thumb?: string;
  kind: 'youtube' | 'vimeo';
};

/** Video id and embeddable player for YouTube and Vimeo watch pages; undefined for channels and other pages. */
export function videoEmbed(url: string): VideoEmbed | undefined {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^(www|m)\./, '');
    const yt = host === 'youtu.be' ? u.pathname.slice(1) : host.endsWith('youtube.com') ? (u.searchParams.get('v') ?? u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{11})/)?.[1]) : undefined;
    if (yt && /^[\w-]{11}$/.test(yt)) {
      return {
        id: yt,
        kind: 'youtube',
        player: `https://www.youtube-nocookie.com/embed/${yt}?rel=0&playsinline=1&enablejsapi=1`,
        thumb: `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`,
      };
    }
    const vimeo = host === 'vimeo.com' ? u.pathname.match(/^\/(\d+)/)?.[1] : undefined;
    if (vimeo) return { id: vimeo, kind: 'vimeo', player: `https://player.vimeo.com/video/${vimeo}?playsinline=1` };
  } catch {
    // not a URL
  }
  return undefined;
}

/** Same player, allowed to start. Set on the frame during a tap, never on the preloaded one. */
export function autoplaySrc(player: string): string {
  const u = new URL(player);
  u.searchParams.set('autoplay', '1');
  return u.toString();
}

/** YouTube only accepts player commands from the page that embedded it. */
export function withOrigin(embed: VideoEmbed, origin: string | undefined): string {
  if (embed.kind !== 'youtube' || !origin) return embed.player;
  const u = new URL(embed.player);
  u.searchParams.set('origin', origin);
  return u.toString();
}

export type PlayerSignal = { ready?: boolean; playing?: boolean };

const playingState = (state: unknown) => state === 1 || state === 3;

function playerState(info: unknown): unknown {
  if (typeof info === 'number') return info;
  if (info && typeof info === 'object' && 'playerState' in info) return info.playerState;
  return undefined;
}

/**
 * YouTube posts JSON strings (`onReady`, `infoDelivery`, `onStateChange`).
 * Vimeo posts objects (`ready`, `play`). Anything else is ignored.
 */
export function playerSignal(data: unknown): PlayerSignal {
  let msg: unknown = data;
  if (typeof data === 'string') {
    try {
      msg = JSON.parse(data) as unknown;
    } catch {
      return {};
    }
  }
  if (!msg || typeof msg !== 'object' || !('event' in msg) || typeof msg.event !== 'string') return {};
  const info = 'info' in msg ? msg.info : undefined;
  switch (msg.event) {
    case 'onReady':
    case 'initialDelivery':
    case 'ready':
      return playingState(playerState(info)) ? { ready: true, playing: true } : { ready: true };
    case 'play':
      return { playing: true };
    case 'onStateChange':
    case 'infoDelivery':
      return playingState(playerState(info)) ? { playing: true } : {};
    default:
      return {};
  }
}
