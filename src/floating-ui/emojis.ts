/** Local emoji "sticker" set with search keywords: instant, offline, and always allowed by Netflix's CSP. */
export interface EmojiEntry { e: string; k: string }

export const EMOJIS: EmojiEntry[] = [
  { e: '🍿', k: 'popcorn movie snack' }, { e: '😂', k: 'laugh lol funny cry' }, { e: '🤣', k: 'rofl lmao dead' },
  { e: '😭', k: 'sob cry sad tears' }, { e: '😱', k: 'scream shock scared omg' }, { e: '😳', k: 'flushed blush awkward' },
  { e: '🥹', k: 'aww touched emotional' }, { e: '😍', k: 'love heart eyes' }, { e: '🥰', k: 'love adore hearts' },
  { e: '😏', k: 'smirk smug' }, { e: '🙄', k: 'eyeroll whatever' }, { e: '🤨', k: 'suspicious eyebrow hmm' },
  { e: '🤯', k: 'mindblown explode wow' }, { e: '🥶', k: 'cold freeze' }, { e: '🥵', k: 'hot sweat' },
  { e: '🤢', k: 'gross sick yuck' }, { e: '😴', k: 'sleep bored zzz' }, { e: '🥱', k: 'yawn boring' },
  { e: '🤡', k: 'clown goofy silly' }, { e: '👻', k: 'ghost boo spooky' }, { e: '💀', k: 'skull dead dying' },
  { e: '👽', k: 'alien' }, { e: '🤖', k: 'robot' }, { e: '😈', k: 'devil evil' },
  { e: '🫠', k: 'melting' }, { e: '🫣', k: 'peek hide scared' }, { e: '🙈', k: 'see no evil monkey hide' },
  { e: '🙉', k: 'hear no evil monkey' }, { e: '🙊', k: 'speak no evil monkey oops' }, { e: '🐸', k: 'frog kermit' },
  { e: '🦆', k: 'duck quack' }, { e: '🐧', k: 'penguin' }, { e: '🦄', k: 'unicorn magic' },
  { e: '🐙', k: 'octopus' }, { e: '🦖', k: 'dinosaur trex rawr' }, { e: '🐢', k: 'turtle slow' },
  { e: '❤️', k: 'heart love red' }, { e: '💔', k: 'broken heart sad' }, { e: '💖', k: 'sparkle heart' },
  { e: '🔥', k: 'fire hot lit' }, { e: '✨', k: 'sparkles magic' }, { e: '💥', k: 'boom explosion' },
  { e: '🎉', k: 'party tada celebrate' }, { e: '🎊', k: 'confetti party' }, { e: '🥳', k: 'party celebrate' },
  { e: '👏', k: 'clap applause bravo' }, { e: '🙌', k: 'hooray praise' }, { e: '🙏', k: 'please pray thanks' },
  { e: '👍', k: 'thumbs up yes good' }, { e: '👎', k: 'thumbs down no bad' }, { e: '👀', k: 'eyes look watching' },
  { e: '🫶', k: 'heart hands love' }, { e: '💅', k: 'nails sassy slay' }, { e: '🤝', k: 'deal handshake' },
  { e: '🧠', k: 'brain smart think' }, { e: '🫡', k: 'salute' }, { e: '🤌', k: 'chefs kiss italian perfect' },
  { e: '🍕', k: 'pizza food' }, { e: '🍩', k: 'donut sweet' }, { e: '🍫', k: 'chocolate' },
  { e: '🧁', k: 'cupcake' }, { e: '🍺', k: 'beer drink cheers' }, { e: '🥤', k: 'soda drink' },
  { e: '☕', k: 'coffee tea' }, { e: '🌶️', k: 'spicy pepper hot' }, { e: '🍑', k: 'peach' },
  { e: '🌈', k: 'rainbow' }, { e: '⚡', k: 'lightning zap' }, { e: '🌙', k: 'moon night' },
  { e: '🎬', k: 'movie clapper film' }, { e: '🎭', k: 'drama masks' }, { e: '🎵', k: 'music note' },
  { e: '💤', k: 'sleep zzz' }, { e: '💯', k: 'hundred perfect' }, { e: '❓', k: 'question what huh' },
  { e: '❗', k: 'exclamation alert' }, { e: '🚨', k: 'alarm siren' }, { e: '🏆', k: 'trophy winner' },
];

export function searchEmojis(q: string): EmojiEntry[] {
  const t = q.trim().toLowerCase();
  return t ? EMOJIS.filter((x) => x.k.includes(t)) : EMOJIS;
}
