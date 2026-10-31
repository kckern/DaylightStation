import { it,expect,vi } from 'vitest';
import { render,screen,fireEvent } from '@testing-library/react';
import SkylineControlPanel from './SkylineControlPanel.jsx';
it('shows four physical positions, avatars, hints and touch actions',()=>{
 const onPress=vi.fn();
 render(<SkylineControlPanel controls={[1,2,3,4].map(position=>({position,action:'test',label:'Choice '+position,hint:position===4?'Hold: menu':'Tap',avatarSrc:position===1?'/child.jpg':null}))} onPress={onPress}/>);
 const buttons=screen.getAllByRole('button');expect(buttons.map(b=>b.dataset.position)).toEqual(['1','2','3','4']);
 expect(screen.getByRole('img',{name:'Choice 1'}).getAttribute('src')).toBe('/child.jpg');
 fireEvent.click(buttons[0]);expect(onPress).toHaveBeenCalledWith(1,'single');
 expect(screen.getByText('Hold: menu')).toBeVisible();
});
