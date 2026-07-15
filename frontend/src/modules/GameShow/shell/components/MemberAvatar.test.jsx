import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MemberAvatar from './MemberAvatar.jsx';

describe('MemberAvatar', () => {
  it('renders the avatar image when member.avatar is set', () => {
    render(<MemberAvatar member={{ id: 'felix', name: 'Felix', avatar: '/api/v1/static/users/felix' }} teamColor="#3273dc" />);
    const img = screen.getByAltText('Felix');
    expect(img.tagName).toBe('IMG');
    expect(img.getAttribute('src')).toBe('/api/v1/static/users/felix');
  });

  it('renders an initial-letter fallback when avatar is null', () => {
    render(<MemberAvatar member={{ id: 'guest_1', name: 'Guest 1', avatar: null }} teamColor="#3273dc" />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('G')).not.toBeNull();
  });

  it('falls back to the initial when the image errors', () => {
    render(<MemberAvatar member={{ id: 'x', name: 'Xander', avatar: '/bad.jpg' }} teamColor="#3273dc" />);
    fireEvent.error(screen.getByAltText('Xander'));
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('X')).not.toBeNull();
  });

  it('shows the name beside the disc when showName is set', () => {
    render(<MemberAvatar member={{ id: 'kckern', name: 'Dad', avatar: null }} teamColor="#3273dc" showName />);
    expect(screen.getByText('Dad')).not.toBeNull();
  });
});
