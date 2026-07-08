import { pressable } from './a11y.mjs';

describe('pressable', () => {
  test('provides button semantics and click handler', () => {
    const fn = vi.fn();
    const props = pressable(fn);
    expect(props.role).toBe('button');
    expect(props.tabIndex).toBe(0);
    props.onClick('evt');
    expect(fn).toHaveBeenCalledWith('evt');
  });

  test('Enter and Space activate; other keys do not', () => {
    const fn = vi.fn();
    const { onKeyDown } = pressable(fn);
    const mkEvt = (key) => ({ key, preventDefault: vi.fn() });
    const enter = mkEvt('Enter');
    onKeyDown(enter);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(enter.preventDefault).toHaveBeenCalled();
    onKeyDown(mkEvt(' '));
    expect(fn).toHaveBeenCalledTimes(2);
    onKeyDown(mkEvt('Escape'));
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test('extra props merge (aria-label etc.)', () => {
    expect(pressable(() => {}, { 'aria-label': 'Open' })['aria-label']).toBe('Open');
  });
});
