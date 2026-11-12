import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

let mockCtx = null;
vi.mock("../context/FitnessContext.jsx", () => ({
  useOptionalFitnessContext: () => mockCtx,
  useFitnessSelector: (select) => select(mockCtx ?? null),
}));

import ImmersiveFrame from "./ImmersiveFrame.jsx";

const renderFrame = (props = {}) => render(
  <ImmersiveFrame nav={<div data-testid="rail" />} {...props}>
    <div data-testid="content" />
  </ImmersiveFrame>
);

describe('ImmersiveFrame', () => {
  it('shows the navigation rail by default', () => {
    mockCtx = { immersive: false };
    const { queryByTestId } = renderFrame();
    expect(queryByTestId('rail')).toBeTruthy();
  });

  it('shows the rail when there is no provider at all', () => {
    mockCtx = null;
    const { queryByTestId } = renderFrame();
    expect(queryByTestId('rail')).toBeTruthy();
  });

  it('does not render the rail while an activity is immersive, and the content stays', () => {
    mockCtx = { immersive: true };
    const { queryByTestId, container } = renderFrame();
    expect(queryByTestId('rail')).toBeNull();
    expect(queryByTestId('content')).toBeTruthy();
    expect(container.querySelector('.fitness-frame--nav-hidden')).toBeTruthy();
  });

  it('still honours the shell own hideNav', () => {
    mockCtx = { immersive: false };
    const { queryByTestId } = renderFrame({ hideNav: true });
    expect(queryByTestId('rail')).toBeNull();
  });
});
