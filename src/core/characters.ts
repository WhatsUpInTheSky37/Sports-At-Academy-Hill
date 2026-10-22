export type CharacterId = 'will' | 'vinnie' | 'bryan' | 'ben' | 'dan' | 'jimmy' | 'billy';

export type HairStyle = 'short' | 'spiky' | 'curly' | 'cap';

export interface Character {
  id: CharacterId;
  name: string;
  /** Last-name initial, shown on team rosters ("Will F"). */
  last: string;
  /** Optional nickname, shown in quotes between first name and initial. */
  nickname?: string;
  skin: string;
  skinShade: string;
  hair: string;
  hairStyle: HairStyle;
  shirt: string;
  shirtShade: string;
  shorts: string;
  shoes: string;
  /** Jersey number painted on the shirt. */
  number: string;
  glasses: boolean;
  accent: number;
  taunts: string[];
  cheers: string[];
  groans: string[];
}

export const CHARACTERS: Record<CharacterId, Character> = {
  will: {
    id: 'will', name: 'Will', last: 'F',
    skin: '#f3c9a6', skinShade: '#d9a981', hair: '#6b4423', hairStyle: 'short',
    shirt: '#3b7dd8', shirtShade: '#2a5aa0', shorts: '#2b3a55', shoes: '#f5f5f5', number: '7',
    glasses: false, accent: 0x3b7dd8,
    taunts: ['Watch this one.', 'My turn!', 'Easy money.'],
    cheers: ['YES!', 'Did you see that?!', 'Let\'s go!'],
    groans: ['Aw man.', 'So close!', 'Rematch after this.'],
  },
  vinnie: {
    id: 'vinnie', name: 'Vinnie', last: 'G',
    skin: '#e8b48d', skinShade: '#c8946c', hair: '#1f1a17', hairStyle: 'spiky',
    shirt: '#e53935', shirtShade: '#a82424', shorts: '#1f2733', shoes: '#212121', number: '3',
    glasses: false, accent: 0xe53935,
    taunts: ['Step aside, rookie.', 'This is my house!', 'Too easy.'],
    cheers: ['BOOM!', 'Champion stuff right there.', 'That\'s how it\'s done!'],
    groans: ['No way!', 'Ugh, do-over?', 'Lucky...'],
  },
  bryan: {
    id: 'bryan', name: 'Bryan', last: 'B',
    skin: '#f7d9c0', skinShade: '#dbb89c', hair: '#e2c070', hairStyle: 'cap',
    shirt: '#43a047', shirtShade: '#2e7030', shorts: '#4e342e', shoes: '#eeeeee', number: '11',
    glasses: false, accent: 0x43a047,
    taunts: ['Here we go.', 'Keep up!', 'Watch and learn.'],
    cheers: ['Nailed it!', 'Woooo!', 'Unstoppable!'],
    groans: ['Noooo.', 'Hold on, again?', 'That stings.'],
  },
  ben: {
    id: 'ben', name: 'Ben', last: 'L',
    skin: '#f0c2a0', skinShade: '#d1a17c', hair: '#b7472a', hairStyle: 'curly',
    shirt: '#fdd835', shirtShade: '#c9a800', shorts: '#37474f', shoes: '#ff7043', number: '22',
    glasses: true, accent: 0xfdd835,
    taunts: ['Calculated.', 'I\'ve done the math.', 'Time to shine.'],
    cheers: ['Science!', 'Ha-HA!', 'Textbook.'],
    groans: ['Recalculating...', 'That was a fluke.', 'Oh come on!'],
  },
  dan: {
    id: 'dan', name: 'Dan', last: 'R',
    skin: '#e9b58f', skinShade: '#c7926b', hair: '#2b2118', hairStyle: 'short',
    shirt: '#7e57c2', shirtShade: '#54398a', shorts: '#263238', shoes: '#f5f5f5', number: '5',
    glasses: false, accent: 0x7e57c2,
    taunts: ['Relax, I got this.', 'Coming through.', 'Nothing to it.'],
    cheers: ['Dan the man!', 'Too smooth!', 'Put it on the board!'],
    groans: ['Ah, c\'mon.', 'Not my day.', 'Wind took it.'],
  },
  jimmy: {
    id: 'jimmy', name: 'Jimmy', nickname: 'Boner', last: 'K',
    skin: '#f6d3b3', skinShade: '#d9ad8c', hair: '#e8d27a', hairStyle: 'spiky',
    shirt: '#fb8c00', shirtShade: '#b55f00', shorts: '#1b2a3a', shoes: '#212121', number: '44',
    glasses: false, accent: 0xfb8c00,
    taunts: ['Boner time!', 'You can\'t stop this.', 'Hold my juice box.'],
    cheers: ['WOO HOO!', 'Legend!', 'Somebody write that down!'],
    groans: ['Bogus!', 'That one hurt.', 'Give me another shot.'],
  },
  billy: {
    id: 'billy', name: 'Billy', last: 'D',
    skin: '#f1c6a3', skinShade: '#d3a37e', hair: '#3e2a1c', hairStyle: 'cap',
    shirt: '#26a69a', shirtShade: '#17706a', shorts: '#2b3a55', shoes: '#eeeeee', number: '9',
    glasses: true, accent: 0x26a69a,
    taunts: ['Okay okay okay.', 'Watch the feet.', 'Here it comes.'],
    cheers: ['Billy D does it!', 'Ha! Yes!', 'Can\'t teach that.'],
    groans: ['Dang it.', 'Hang on, again.', 'Sun was in my eyes.'],
  },
};

export const CHARACTER_IDS: CharacterId[] = ['will', 'vinnie', 'bryan', 'ben', 'dan', 'jimmy', 'billy'];

/** Roster-style name: 'Will F', 'Jimmy "Boner" K'. */
export function displayName(ch: Character): string {
  return ch.nickname ? `${ch.name} "${ch.nickname}" ${ch.last}` : `${ch.name} ${ch.last}`;
}

export function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
