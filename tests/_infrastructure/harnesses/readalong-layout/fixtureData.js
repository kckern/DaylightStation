// Psalm 49 fixture in the /api/v1/info readalong shape (NIrV-style poetry),
// enough verses to force real scrolling at 1280x800.
const lines = [
  ['Hear this, all you nations.', 'Listen, all you who live in this world.'],
  ['Listen, no matter who you are, rich or poor.', ''],
  ['My mouth will speak wise words.', 'What I say from my heart will give understanding.'],
  ['I will pay attention to a proverb.', 'I will explain my riddle as I play the harp.'],
  ['Why should I be afraid when trouble comes?', 'Why should I fear when sinners are all around me?'],
  ['They trust in their wealth.', 'They brag about how rich they are.'],
  ['No one can pay for the life of anyone else.', 'No one can give God what that would cost.'],
  ['The price for a life is very high.', 'No payment is ever enough.'],
  ['No one can pay enough to live forever', 'and not rot in the grave.'],
  ['Everyone can see that even wise people die.', 'People who are foolish and who have no sense also pass away.'],
  ['All of them leave their wealth to others.', ''],
  ['Their graves will remain their houses forever.', 'Their graves will be their homes for all time to come.'],
  ['People who have riches but do not understand', 'are like the animals. They die.'],
  ['That is what happens to those who trust in themselves.', 'It also happens to their followers, who agree with what they say.'],
  ['They are like sheep and will end up in the grave.', 'Death will be their shepherd.'],
  ['But God will save me from the place of the dead.', 'He will certainly take me to himself.'],
  ['Do not get too upset when other people become rich.', 'Do not be troubled when the glory of their houses increases.'],
  ['They will not take anything with them when they die.', 'Their glory will not go down to the grave with them.'],
  ['While they lived, they believed they were blessed.', 'People praised them when they were successful.'],
  ['But they will die, like their people of long ago.', 'They will never again see the light of day.'],
  ['People who have riches but do not understand', 'are like the animals. They die.'],
];

const verses = lines.map(([a, b], i) => ({
  verse_id: 15000 + i,
  verse: i + 1,
  format: 'poetry',
  text: b ? `${a}\n${b}` : a,
  ...(i === 0 ? { headings: { heading: 'For the director of music. A psalm of the Sons of Korah.' } } : {}),
}));

export default {
  id: 'readalong:scripture/fixture-ps-49',
  title: 'Psalms 49',
  type: 'scripture',
  mediaUrl: '/fixture.wav',
  content: { type: 'verses', data: verses },
};
