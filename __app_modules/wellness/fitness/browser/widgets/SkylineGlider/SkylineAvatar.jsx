import React from 'react';
import {DaylightImagePath} from '@/lib/api.mjs';
export default function SkylineAvatar({src,name}){
 return <img src={src||DaylightImagePath('users/user')} alt={name} onError={event=>{
  const image=event.currentTarget;
  if(image.dataset.fallback){image.style.visibility='hidden';return}
  image.dataset.fallback='true';image.src=DaylightImagePath('users/user');
 }}/>;
}
