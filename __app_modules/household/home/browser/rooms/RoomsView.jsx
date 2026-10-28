import { useMemo, useState } from 'react';
import { UnstyledButton } from '@mantine/core';
import { IconChevronRight } from '@tabler/icons-react';
import { EmptyState } from '@/lib/ui';
import { summarizeRooms } from './summarizeRooms.js';
import { EntityRow } from '../ui/EntityRow.jsx';
import { Disclosure } from '../ui/Disclosure.jsx';
import { EntityDetailSheet } from '../ui/EntityDetailSheet.jsx';
import { useEntityDetail } from '../ui/useEntityDetail.js';
import { formatAge, formatDegrees } from '../entities/formatEntityState.js';
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
export function RoomsView({ entities, rooms, types, haUrl, toggle, turnOff }) {
  const summaries = useMemo(() => summarizeRooms(entities, rooms), [entities, rooms]);
  const [openId, setOpenId] = useState(null);
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
        const lit = room.lights.filter((e) => e.stateClass === 'on' && e.controllable && !e.pending);
        return (
          <div key={room.id} className={`home-room${open ? ' home-room--open' : ''}${room.lightsOn ? ' home-room--lit' : ''}`} data-room-id={room.id}>
            <UnstyledButton className="home-room__row" onClick={() => toggleRoom(room)} aria-expanded={open}>
              <span className="home-room__name">{room.name}</span>
              <span className="home-room__lights">
                {room.lights.length === 0 ? <span className="home-room__none">no lights</span>
                  : room.lightsOn ? <><span className="home-room__dot" aria-hidden="true" />{room.lightsOn} on</>
                    : <span className="home-room__none">dark</span>}
              </span>
              <span className="home-room__temp">{room.temperature ? formatDegrees(room.temperature.value) : <span className="home-room__none">–</span>}</span>
              <span className="home-room__motion">
                {!room.motion ? <span className="home-room__none">–</span> : room.motion.now ? 'now' : formatAge(room.motion.at)}
              </span>
              <IconChevronRight className="home-room__chevron" size={16} stroke={2} aria-hidden="true" />
            </UnstyledButton>

            {open ? (
              <div className="home-room__body">
                {room.lights.length ? (
                  <div className="home-room__block home-rows--ruled">
                    {room.lights.map((e) => <EntityRow key={e.id} entity={e} control="switch" onToggle={toggle} onOpen={detail.open} />)}
                    {lit.length > 1 ? (
                      <UnstyledButton
                        className="home-textaction home-room__off"
                        onClick={() => { logger.info('home.room.off', { roomId: room.id, count: lit.length }); turnOff(lit); }}
                        aria-label={`Turn off all ${lit.length} lights in ${room.name}`}
                      >
                        Turn off all {lit.length}
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
                  <p className="home-section__note">Nothing in this room is shown on the dashboard.</p>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
      <EntityDetailSheet entity={detail.selected} haUrl={haUrl} onToggle={toggle} onClose={detail.close} typeLabel={detail.selected ? typeLabel(detail.selected.type) : null} />
    </div>
  );
}

export default RoomsView;
