export default {
  id: 'jumping_jack_game',
  name: 'Jumping Jacks',
  version: '1.0.0',
  icon: 'activity',
  description: 'Count your jumping jacks using camera motion detection',
  modes: { standalone: true, overlay: true, sidebar: false, mini: false },
  requires: { sessionActive: true, camera: true },
  category: 'games'
};
