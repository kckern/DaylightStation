import { it,expect,vi,afterEach } from 'vitest';
import { render,screen,fireEvent } from '@testing-library/react';
import SkylineControlPanel from './SkylineControlPanel.jsx';
afterEach(()=>vi.useRealTimers());
it('shows four physical positions, avatars, hints and touch actions',()=>{
 const onPress=vi.fn();
 render(<SkylineControlPanel controls={[1,2,3,4].map(position=>({position,action:'test',label:'Choice '+position,hint:position===4?'Hold: menu':'Tap',avatarSrc:position===1?'/child.jpg':null}))} onPress={onPress}/>);
 const buttons=screen.getAllByRole('button');expect(buttons.map(b=>b.dataset.position)).toEqual(['1','2','3','4']);
 expect(screen.getByRole('img',{name:'Choice 1'}).getAttribute('src')).toBe('/child.jpg');
 fireEvent.click(buttons[1]);expect(onPress).toHaveBeenCalledWith(2,'single');
 expect(screen.getByText('Hold: menu')).toBeVisible();
 const image=screen.getByRole('img',{name:'Choice 1'});fireEvent.error(image);
 expect(image.src).toMatch(/\/users\/user$/);
});
it('resolves an identity double press once instead of selecting the single rider first',()=>{
 vi.useFakeTimers();const onPress=vi.fn();
 render(<SkylineControlPanel controls={[{position:1,label:'Child',avatarSrc:'/child.jpg'}]} onPress={onPress}/>);
 const button=screen.getByRole('button');fireEvent.click(button);fireEvent.click(button);fireEvent.doubleClick(button);
 vi.advanceTimersByTime(400);
 expect(onPress.mock.calls).toEqual([[1,'double']]);vi.useRealTimers();
});
