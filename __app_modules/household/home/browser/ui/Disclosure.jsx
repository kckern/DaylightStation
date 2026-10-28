import { useId, useState } from 'react';
import { UnstyledButton } from '@mantine/core';
import { IconChevronRight } from '@tabler/icons-react';
import './home-ui.scss';

/**
 * "9 batteries low" that opens into the nine. Counts first, lists on demand.
 *
 * @param {Object} props
 * @param {string} props.label
 * @param {(open: boolean) => void} [props.onToggle]
 * @param {boolean} [props.defaultOpen]
 */
export function Disclosure({ label, onToggle, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  const toggle = () => {
    const next = !open;
    setOpen(next);
    onToggle?.(next);
  };
  return (
    <div className={`home-disclosure${open ? ' home-disclosure--open' : ''}`}>
      <UnstyledButton className="home-disclosure__button" onClick={toggle} aria-expanded={open} aria-controls={id}>
        <IconChevronRight className="home-disclosure__chevron" size={16} stroke={2} aria-hidden="true" />
        <span>{label}</span>
      </UnstyledButton>
      {open ? <div className="home-disclosure__body" id={id}>{children}</div> : null}
    </div>
  );
}

export default Disclosure;
