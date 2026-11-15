import React from 'react';
import {FitnessGameGate} from '../../components/FitnessGameGate.jsx';
import SkylineGlider from "./SkylineGlider.jsx";
export default function GatedSkylineGlider(props){
  return <FitnessGameGate moduleId="skyline_glider" label="Skyline Glider" onClose={props.onClose}><SkylineGlider {...props}/></FitnessGameGate>;
}
export const manifest = { id: 'skyline_glider', name: 'Skyline Glider', icon: '🛩️', description: 'Pedal to fly an alpine glider.' };
