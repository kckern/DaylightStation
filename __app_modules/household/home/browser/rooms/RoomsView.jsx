import { useCallback, useMemo, useRef, useState } from 'react';
import { UnstyledButton, VisuallyHidden } from '@mantine/core';
import { IconChevronRight } from '@tabler/icons-react';
import { EmptyState } from '@/lib/ui';
import { summarizeRooms } from './summarizeRooms.js';
import { EntityRow } from '../ui/EntityRow.jsx';
import { Disclosure } from '../ui/Disclosure.jsx';
import { EntityDetailSheet } from '../ui/EntityDetailSheet.jsx';
import { useEntityDetail } from '../ui/useEntityDetail.js';
import { formatAge, formatDegrees } from '../entities/formatEntityState.js';
import { canTurnOff } from '../entities/useHomeEntities.js';
import { turnOffLabel } from '../ui/turnOffLabel.js';
import homeLogger from '../homeLogger.js';
import '../ui/home-ui.scss';
import './RoomsView.scss';

const logger = homeLogger.child({ component: 'rooms' });

function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * One row per room: name, lights, temperature, last motion. Tap to open the
 * room in place; its readings sit behind "Show all".
 */
export function RoomsView({ entities, rooms, types, summary, haUrl, toggle, turnOff, roomCommands, getFallbackFocusTarget }) {
  const staleMs = (summary?.thresholds?.motionStaleHours ?? Infinity) * 3_600_000;
  const summaries = useMemo(() => summarizeRooms(entities, rooms, { staleMs }), [entities, rooms, staleMs]);
  const [openId, setOpenId] = useState(null);
  const openHeader = useRef(null);
  const getDetailFallback = useCallback(() => openHeader.current ?? getFallbackFocusTarget?.(), [getFallbackFocusTarget]);
  const actionButton = useRef(null);
  const bindAction = useCallback(node => {
    if (!node && actionButton.current === document.activeElement) openHeader.current?.focus({ preventScroll: true });
    actionButton.current = node;
  }, []);
  const detail = useEntityDetail(entities);
  const typeLabel = (type) => types.find((t) => t.id === type)?.label;

  const toggleRoom = (room) => {
    const next = openId === room.id ? null : room.id;
    logger.info('home.room.expand', { roomId: room.id, open: Boolean(next), lights: room.lights.length, devices: room.devices.length, more: room.more.length });
    setOpenId(next);
  };

  if (!summaries.length) {
    return <EmptyState title="No rooms yet" hint="Assign devices to areas in Home Assistant, or add room_aliases to the home dashboard config." />;
  }

  return (
    <div className="home-rooms">
      <div className="home-rooms__legend" aria-hidden="true">
        <span />
        <span>Lights</span>
        <span>Temp</span>
        <span>Motion</span>
        <span />
      </div>
      {summaries.map((room) => {
        const open = openId === room.id;
        const lit = room.lights.filter(canTurnOff);
        const command = roomCommands[room.id];
        const failed = command && !command.pending ? lit.filter(entity => command.ids.includes(entity.id)) : [];
        const targets = failed.length ? failed : lit;
        const submit = () => {
          logger.info('home.room.off', { roomId: room.id, count: targets.length });
          turnOff(room.id, targets);
        };
        return (
          <div key={room.id} className={`home-room${open ? ' home-room--open' : ''}${room.lightsOn ? ' home-room--lit' : ''}`} data-room-id={room.id}>
            <UnstyledButton ref={open ? openHeader : null} className="home-room__row" onClick={() => toggleRoom(room)} aria-expanded={open}>
              <span className="home-room__name">{room.name}</span>
              {/* A cell says something or stays blank: a column of "dark" and dashes is noise. */}
              <span className="home-room__lights">
                {room.lightsOn ? <><span className="home-room__dot" aria-hidden="true" />{room.lightsOn}<VisuallyHidden> {room.lightsOn === 1 ? 'light' : 'lights'}</VisuallyHidden> on</> : null}
              </span>
              <span className="home-room__temp">{room.temperature ? formatDegrees(room.temperature.value) : null}</span>
              <span className="home-room__motion">
                {!room.motion ? null : <><VisuallyHidden>Motion detected: </VisuallyHidden>{room.motion.now ? 'now' : formatAge(room.motion.at)}</>}
              </span>
              <IconChevronRight className="home-room__chevron" size={16} stroke={2} aria-hidden="true" />
            </UnstyledButton>

            {open ? (
              <div className="home-room__body">
                {room.lights.length ? (
                  <div className="home-room__block home-rows--ruled">
                    {room.lights.map((e) => <EntityRow key={e.id} entity={e} control="switch" onToggle={toggle} onOpen={detail.open} />)}
                    {command?.pending && <p role="status" className="home-note">Turning off lights in {room.name}…</p>}
                    {failed.length > 0 && <p role="alert" className="home-note">Couldn’t turn off {failed.map(entity => entity.name).join(', ')}.</p>}
                    {!command?.pending && (failed.length || lit.length > 1) ? (
                      <UnstyledButton
                        key={failed.length ? 'retry' : 'all'}
                        ref={bindAction}
                        className="home-textaction home-room__off"
                        onClick={submit}
                        aria-label={failed.length ? `Retry turning off ${plural(failed.length, 'light')} in ${room.name}` : `Turn off all ${lit.length} lights in ${room.name}`}
                      >
                        {failed.length ? 'Retry' : turnOffLabel(lit.length)}
                      </UnstyledButton>
                    ) : null}
                  </div>
                ) : null}
                {room.devices.length ? (
                  <div className="home-room__block home-rows--ruled">
                    {room.devices.map((e) => <EntityRow key={e.id} entity={e} sub={typeLabel(e.type)} control="switch" onToggle={toggle} onOpen={detail.open} />)}
                  </div>
                ) : null}
                {room.more.length ? (
                  <Disclosure
                    label={`Show all ${room.more.length} readings and switches`}
                    onToggle={(isOpen) => logger.debug('home.room.more', { roomId: room.id, open: isOpen, count: room.more.length })}
                  >
                    <div className="home-rows--ruled">
                      {room.more.map((e) => <EntityRow key={e.id} entity={e} sub={typeLabel(e.type)} onOpen={detail.open} />)}
                    </div>
                  </Disclosure>
                ) : null}
                {!room.lights.length && !room.devices.length && !room.more.length ? (
                  <p className="home-note">Nothing in this room is shown on the dashboard.</p>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
      <EntityDetailSheet entity={detail.selected} haUrl={haUrl} onToggle={toggle} onClose={detail.close}
        getFallbackFocusTarget={getDetailFallback} />
    </div>
  );
}

export default RoomsView;
