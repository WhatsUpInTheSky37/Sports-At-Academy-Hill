export type CharacterId = 'will' | 'vinnie' | 'bryan' | 'ben';

export type HairStyle = 'short' | 'spiky' | 'curly' | 'cap';

export interface Character {
  id: CharacterId;
  name: string;
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
    id: 'will', name: 'Will',
    skin: '#f3c9a6', skinShade: '#d9a981', hair: '#6b4423', hairStyle: 'short',
    shirt: '#3b7dd8', shirtShade: '#2a5aa0', shorts: '#2b3a55', shoes: '#f5f5f5', number: '7',
    glasses: false, accent: 0x3b7dd8,
    taunts: ['Watch this one.', 'My turn!', 'Easy money.'],
    cheers: ['YES!', 'Did you see that?!', 'Let\'s go!'],
    groans: ['Aw man.', 'So close!', 'Rematch after this.'],
  },
  vinnie: {
    id: 'vinnie', name: 'Vinnie',
    skin: '#e8b48d', skinShade: '#c8946c', hair: '#1f1a17', hairStyle: 'spiky',
    shirt: '#e53935', shirtShade: '#a82424', shorts: '#1f2733', shoes: '#212121', number: '3',
    glasses: false, accent: 0xe53935,
    taunts: ['Step aside, rookie.', 'This is my house!', 'Too easy.'],
    cheers: ['BOOM!', 'Champion stuff right there.', 'That\'s how it\'s done!'],
    groans: ['No way!', 'Ugh, do-over?', 'Lucky...'],
  },
  bryan: {
    id: 'bryan', name: 'Bryan',
    skin: '#f7d9c0', skinShade: '#dbb89c', hair: '#e2c070', hairStyle: 'cap',
    shirt: '#43a047', shirtShade: '#2e7030', shorts: '#4e342e', shoes: '#eeeeee', number: '11',
    glasses: false, accent: 0x43a047,
    taunts: ['Here we go.', 'Keep up!', 'Watch and learn.'],
    cheers: ['Nailed it!', 'Woooo!', 'Unstoppable!'],
    groans: ['Noooo.', 'Hold on, again?', 'That stings.'],
  },
  ben: {
    id: 'ben', name: 'Ben',
    skin: '#f0c2a0', skinShade: '#d1a17c', hair: '#b7472a', hairStyle: 'curly',
    shirt: '#fdd835', shirtShade: '#c9a800', shorts: '#37474f', shoes: '#ff7043', number: '22',
    glasses: true, accent: 0xfdd835,
    taunts: ['Calculated.', 'I\'ve done the math.', 'Time to shine.'],
    cheers: ['Science!', 'Ha-HA!', 'Textbook.'],
    groans: ['Recalculating...', 'That was a fluke.', 'Oh come on!'],
  },
};

export const CHARACTER_IDS: CharacterId[] = ['will', 'vinnie', 'bryan', 'ben'];

export function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
