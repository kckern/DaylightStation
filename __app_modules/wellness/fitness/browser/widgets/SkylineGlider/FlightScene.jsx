import React from 'react';
import { projectCourseWindow } from "../../lib/skylineGlider/courseProjection.js";
import { SHUTTER_WARN_S, SKYLINE_CRAFT_GEOMETRY } from "../../lib/skylineGlider/flightGeometry.js";
import { cameraTime } from "../../lib/skylineGlider/liftBoost.js";
import { weaponRules } from "../../lib/skylineGlider/weapons.js";
import { EMPTY_ZONE_ASSETS } from "../../lib/skylineGlider/zoneAssets.js";
import { PadGlyph, PixelIcon } from "./SkylinePixelIcons.jsx";
import {
  BackdropPreset, BellPreset, BlastPreset, BombPreset, CheckpointPreset, DEFAULT_ZONE, EntityPreset, FinishPreset,
  GliderPreset, LaserPreset, SCENE_HEIGHT, SCENE_WIDTH, SceneDefs, TerrainPreset, hasBackdropPreset,
} from "./svgPresets.jsx";

// The flight scene is a stack of layers drawn from the act's resolved zone:
// backdrops → terrain → entities → collectibles → shots → craft → blasts → foreground → effects.
// Every slot uses its file when one loaded and its SVG preset otherwise.

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function frameName(spec, time) {
  const frames = spec?.frames || (spec?.frame ? [spec.frame] : []);
  if (!frames.length) return null;
  const fps = Number(spec.fps) > 0 ? Number(spec.fps) : 8;
  return frames[Math.floor(Math.max(0, time) * fps) % frames.length];
}

// Scene units per art pixel for the act's zone (zone.pixel_scale). With it,
// every sprite draws at exactly that grain, aligned inside its box, so sprites,
// terrain and backdrops share one pixel grid; without it a frame is fitted to
// its box. Collision boxes are unaffected either way.
const PixelScale = React.createContext(null);
const ALIGN = { xMin: 0, xMid: 0.5, xMax: 1, YMin: 0, YMid: 0.5, YMax: 1 };

function SpriteFrame({ assets, name, x, y, width, height, align = 'xMidYMax' }) {
  const pixel = React.useContext(PixelScale);
  const frame = assets.frames?.[name];
  if (!frame || !assets.sheet) return null;
  if (pixel) {
    const w = frame.w * pixel; const h = frame.h * pixel;
    const left = x + (width - w) * ALIGN[align.slice(0, 4)]; const top = y + (height - h) * ALIGN[align.slice(4)];
    return <svg x={left} y={top} width={w} height={h} viewBox={`${frame.x} ${frame.y} ${frame.w} ${frame.h}`} preserveAspectRatio="none">
      <image href={assets.sheet.url} width={assets.sheet.width} height={assets.sheet.height}/>
    </svg>;
  }
  return <svg x={x} y={y} width={width} height={height} viewBox={`${frame.x} ${frame.y} ${frame.w} ${frame.h}`} preserveAspectRatio={`${align} meet`}>
    <image href={assets.sheet.url} width={assets.sheet.width} height={assets.sheet.height}/>
  </svg>;
}

const hasFrame = (assets, name) => !!(name && assets.sheet && assets.frames?.[name]);

// Vertical 3-slice for things whose height changes per placement (walls, posts,
// shutters): top cap, a body repeated down the box, bottom cap. The body's last
// copy is cut off by the box. Drawn at the zone's pixel scale, centred across.
function SlicedSprite({ id, assets, slices, x, y, width, height }) {
  const pixel = React.useContext(PixelScale);
  const frame = (name) => (name ? assets.frames?.[name] : null);
  const body = frame(slices.body);
  if (!body || !assets.sheet || height <= 0) return null;
  const scale = pixel || width / body.w;
  const w = body.w * scale; const left = x + (width - w) / 2;
  const top = frame(slices.top); const bottom = frame(slices.bottom);
  const topH = top ? top.h * scale : 0; const bottomH = bottom ? bottom.h * scale : 0;
  const part = (f, py, ph, key) => <svg key={key} x={left} y={py} width={w} height={ph} viewBox={`${f.x} ${f.y} ${f.w} ${ph / scale}`} preserveAspectRatio="none">
    <image href={assets.sheet.url} width={assets.sheet.width} height={assets.sheet.height}/>
  </svg>;
  // The body is one rect filled with a pattern of the tile: separate copies would
  // leave antialiased seams wherever a join lands between screen pixels.
  const bodyTop = y + topH; const bodyH = Math.max(0, y + height - bottomH - bodyTop);
  const patternId = `slice-${id}`;
  return <g data-sliced="true">
    {bodyH > 0 && <>
      <pattern id={patternId} patternUnits="userSpaceOnUse" x={left} y={bodyTop} width={w} height={body.h * scale}>
        <svg width={w} height={body.h * scale} viewBox={`${body.x} ${body.y} ${body.w} ${body.h}`} preserveAspectRatio="none">
          <image href={assets.sheet.url} width={assets.sheet.width} height={assets.sheet.height}/>
        </svg>
      </pattern>
      <rect data-slice="body" x={left} y={bodyTop} width={w} height={bodyH} fill={`url(#${patternId})`}/>
    </>}
    {top && part(top, y, Math.min(topH, height), 'top')}
    {bottom && part(bottom, y + height - bottomH, bottomH, 'bottom')}
  </g>;
}

function ImageStrip({ layer, image, scroll }) {
  const height = clamp(Number(layer.height ?? 1), 0.01, 1) * SCENE_HEIGHT;
  const y = Number(layer.y ?? 0) * SCENE_HEIGHT;
  const tileWidth = image.width * (height / image.height);
  const offset = (scroll * Number(layer.parallax ?? 0)) % tileWidth;
  const count = Math.ceil(SCENE_WIDTH / tileWidth) + 1;
  return <g className="skyline-glider__image-layer" data-layer={layer.id} opacity={layer.opacity ?? 1}>
    {Array.from({ length: count }, (_, index) => <image key={index} href={image.url} x={index * tileWidth - offset} y={y} width={tileWidth + 0.5} height={height} preserveAspectRatio="none"/>)}
  </g>;
}

function Layer({ layer, assets, scroll }) {
  if (layer.kind === 'image') {
    const image = assets.images.get(layer.src);
    if (image) return <ImageStrip layer={layer} image={image} scroll={scroll}/>;
    return hasBackdropPreset(layer.fallback) ? <BackdropPreset draw={layer.fallback} offset={scroll * Number(layer.parallax ?? 0)}/> : null;
  }
  return <BackdropPreset draw={layer.draw} offset={scroll * Number(layer.parallax ?? 0)}/>;
}

function EdgeStrip({ id, image, x, width, top, height, flip }) {
  const tileWidth = image.width * (height / image.height);
  return <>
    <pattern id={id} patternUnits="userSpaceOnUse" width={tileWidth} height={height} patternTransform={`translate(${x} ${top})${flip ? ` translate(0 ${height}) scale(1 -1)` : ''}`}>
      <image href={image.url} width={tileWidth} height={height} preserveAspectRatio="none"/>
    </pattern>
    <rect x={x} y={top} width={width} height={height} fill={`url(#${id})`} className="skyline-glider__terrain-edge"/>
  </>;
}

// Image-skinned terrain: the fill texture is locked to the course, and the edge
// strip rises `edge_lip` above the collision line, so grass tips can be brushed.
function SkinnedTerrain({ segment, terrain, fill, edge, ceilingEdge }) {
  const width = Math.max(4, segment.width);
  const lip = Number(terrain.edge_lip ?? 0.02) * SCENE_HEIGHT;
  const edgeHeight = Number(terrain.edge_height ?? 0.06) * SCENE_HEIGHT;
  const rockProps = (kind) => (fill ? { fill: 'url(#glider-terrain-fill)' } : { className: `skyline-glider__terrain skyline-glider__terrain--${kind}` });
  const floorAt = segment.type === 'lower-terrain' ? segment.top : segment.type === 'corridor' ? segment.floor : null;
  const ceilingAt = segment.type === 'upper-terrain' ? segment.bottom : segment.type === 'corridor' ? segment.ceiling : null;
  const roof = ceilingEdge || edge;
  return <>
    {ceilingAt != null && <rect x={segment.x} y="0" width={width} height={ceilingAt * SCENE_HEIGHT} {...rockProps('upper')}/>}
    {floorAt != null && <rect x={segment.x} y={floorAt * SCENE_HEIGHT} width={width} height={SCENE_HEIGHT - floorAt * SCENE_HEIGHT} {...rockProps('lower')}/>}
    {floorAt != null && edge && <EdgeStrip id={`glider-edge-floor-${segment.id}`} image={edge} x={segment.x} width={width} top={floorAt * SCENE_HEIGHT - lip} height={edgeHeight}/>}
    {ceilingAt != null && roof && <EdgeStrip id={`glider-edge-roof-${segment.id}`} image={roof} flip={!ceilingEdge} x={segment.x} width={width} top={ceilingAt * SCENE_HEIGHT + lip - edgeHeight} height={edgeHeight}/>}
  </>;
}

function CourseSegment({ segment, zone, assets, time }) {
  const testProps = { 'data-testid': `course-segment-${segment.id}`, 'data-type': segment.type };
  if (segment.type === 'checkpoint') {
    const name = frameName(zone.checkpoint, time);
    return <g {...testProps} transform={`translate(${segment.x} 0)`} className="skyline-glider__checkpoint">
      {hasFrame(assets, name) ? <SpriteFrame assets={assets} name={name} x={-40} y={90} width={80} height={440}/> : <CheckpointPreset/>}
    </g>;
  }
  if (segment.type === 'finish') {
    const name = frameName(zone.finish, time);
    return <g {...testProps} transform={`translate(${segment.x} 0)`} className="skyline-glider__finish">
      {hasFrame(assets, name) ? <SpriteFrame assets={assets} name={name} x={-60} y={80} width={120} height={430}/> : <FinishPreset/>}
    </g>;
  }
  const terrain = zone.terrain || {};
  const fill = assets.images.get(terrain.fill);
  const edge = assets.images.get(terrain.edge);
  const ceilingEdge = assets.images.get(terrain.ceiling_edge);
  return <g {...testProps}>
    {segment.profilePoints?.length || segment.type === 'lava' ? <TerrainPreset segment={segment} fill={fill ? 'url(#glider-terrain-fill)' : undefined}/> : fill || edge || ceilingEdge
      ? <SkinnedTerrain segment={segment} terrain={terrain} fill={fill} edge={edge} ceilingEdge={ceilingEdge}/>
      : <TerrainPreset segment={segment}/>}
  </g>;
}

// What the rider should do about an entity: an explicit `role` wins, else it
// is read from what can break it. Only an armed flight marks anything to shoot.
export function entityRole(entity, armed) {
  if (entity.role) return entity.role === 'shoot' && !armed ? 'avoid' : entity.role;
  if (entity.class === 'scenery') return 'scenery';
  if (entity.required_weapon) return entity.required_weapon;
  return 'avoid';
}

// A shutter warns for SHUTTER_WARN_S (blinking gap edges, BOOST label) and
// then slams shut over the last SHUTTER_SLAM_S; it only becomes solid at
// closes_at_s (see flightGeometry entityPresent), so the slam is kept short
// enough that nothing on screen ever looks closed while it is still open.
export const SHUTTER_SLAM_S = .4;
export function shutterProgress(entity, camera) {
  if (entity.closes_at_s == null) return { warning: false, closed: 1 };
  const closed = clamp((camera - (entity.closes_at_s - SHUTTER_SLAM_S)) / SHUTTER_SLAM_S, 0, 1);
  return { warning: closed < 1 && camera >= entity.closes_at_s - SHUTTER_WARN_S, closed };
}

// The scene's art grain in scene units: every mark below is built from it, so
// brackets, plates and arrows sit on the same pixel grid as the sprites.
const U = 3;

// A rectangle with one-pixel stepped corners.
const plate = (x, y, w, h) => `M${x + U} ${y}H${x + w - U}V${y + U}H${x + w}V${y + h - U}H${x + w - U}V${y + h}H${x + U}V${y + h - U}H${x}V${y + U}H${x + U}Z`;

// What to press about a thing, as a sign: which of the four bike buttons (the
// 2×2 block, one lit), the word, and an arrow showing where the shot goes.
// `width` is the word's drawn width, pinned with textLength so the sign is the
// same size whatever font the browser ends up with.
const CALLOUT = Object.freeze({
  bomb: { text: 'BOMB', width: 63, position: 2, arrow: 'drop' },
  missile: { text: 'MISSILE', width: 99, position: 3, arrow: 'fire' },
  boost: { text: 'BOOST', width: 78, position: 4, arrow: 'dash' },
});
const CALLOUT_HEIGHT = 13 * U;
// Kept below the HUD, so a full-height wall still gets a readable sign.
const CALLOUT_MIN_TOP = 105;

function Callout({ role, centre, bottom }) {
  const { text, width, position, arrow } = CALLOUT[role];
  const glyph = 9 * U;
  const total = 2 * U + glyph + U + width + U + glyph + 2 * U;
  const x = centre - total / 2; const y = Math.max(bottom - CALLOUT_HEIGHT, CALLOUT_MIN_TOP);
  return <g className={`skyline-glider__callout skyline-glider__${role}-mark`} data-role={role}>
    <path className="skyline-glider__callout-rim" d={plate(x, y, total, CALLOUT_HEIGHT)}/>
    <path className="skyline-glider__callout-edge" d={plate(x + U, y + U, total - 2 * U, CALLOUT_HEIGHT - 2 * U)}/>
    <path className="skyline-glider__callout-face" d={plate(x + 2 * U, y + 2 * U, total - 4 * U, CALLOUT_HEIGHT - 4 * U)}/>
    <PadGlyph position={position} x={x + 2 * U} y={y + 2 * U} px={U}/>
    <text x={x + 2 * U + glyph + U} y={y + CALLOUT_HEIGHT - 3 * U - 1} textLength={width} lengthAdjust="spacingAndGlyphs">{text}</text>
    <g className={`skyline-glider__callout-arrow skyline-glider__callout-arrow--${arrow}`}>
      <PixelIcon name={arrow} x={x + total - 2 * U - glyph} y={y + 2 * U} px={U}/>
    </g>
  </g>;
}

// One corner of a target bracket as a filled L, `grow` pixels fatter for the rim.
function corner(x, y, dx, dy, grow) {
  const arm = 5 * U + 2 * grow; const thick = 2 * U + 2 * grow;
  const ox = x - dx * grow; const oy = y - dy * grow;
  return `M${ox} ${oy}h${dx * arm}v${dy * thick}h${-dx * (arm - thick)}v${dy * (arm - thick)}h${-dx * thick}Z`;
}

function TargetMarks({ entity, damage }) {
  const pad = 3 * U;
  const left = entity.x - pad, right = entity.x + entity.width + pad;
  const top = entity.y - pad, bottom = entity.y + entity.height + pad;
  const hitPoints = entity.hit_points || 1;
  const remaining = Math.max(0, hitPoints - (damage || 0));
  const pipWidth = 6 * U, pipHeight = 3 * U, gap = U;
  const pipsWidth = hitPoints * pipWidth + (hitPoints - 1) * gap;
  const pipsLeft = entity.x + entity.width / 2 - pipsWidth / 2;
  const corners = (grow) => corner(left, top, 1, 1, grow) + corner(right, top, -1, 1, grow) + corner(right, bottom, -1, -1, grow) + corner(left, bottom, 1, -1, grow);
  return <g className="skyline-glider__target-marks" data-testid={`target-marks-${entity.id}`}>
    <g className="skyline-glider__target-brackets">
      <path className="skyline-glider__target-rim" d={corners(U)}/>
      <path className="skyline-glider__target-line" d={corners(0)}/>
    </g>
    {hitPoints > 1 && <g className="skyline-glider__target-pips" data-remaining={remaining}>
      <rect className="skyline-glider__target-rim" x={pipsLeft - U} y={bottom + 2 * U} width={pipsWidth + 2 * U} height={pipHeight + 2 * U}/>
      {Array.from({ length: hitPoints }, (_, index) => <rect key={index} x={pipsLeft + index * (pipWidth + gap)} y={bottom + 3 * U} width={pipWidth} height={pipHeight} data-full={index < remaining ? 'true' : 'false'}/>)}
    </g>}
  </g>;
}

// The closing gap's edges: a red-and-white hazard strip along the top and
// bottom of the opening, blinking until the gate slams.
function HazardStrip({ x, y, width }) {
  return <>
    <rect className="skyline-glider__hazard-rim" x={x - U} y={y - 2 * U} width={width + 2 * U} height={4 * U}/>
    <rect className="skyline-glider__hazard-base" x={x} y={y - U} width={width} height={2 * U}/>
    <path className="skyline-glider__hazard-dash" d={`M${x} ${y}H${x + width}`}/>
  </>;
}

function Shutter({ entity, assets, progress: { warning, closed } }) {
  const height = entity.height * closed;
  const stripX = entity.x - 2 * U; const stripWidth = Math.ceil((entity.width + 4 * U) / (2 * U)) * 2 * U;
  return <g data-testid={`course-entity-${entity.id}`} data-class={entity.class} data-role="boost" data-progress={Math.round(closed * 100) / 100} data-warning={warning ? 'true' : 'false'} className="skyline-glider__entity skyline-glider__entity--shutter">
    {height > 0 && (entity.slices && hasFrame(assets, entity.slices.body)
      ? <SlicedSprite id={entity.id} assets={assets} slices={entity.slices} x={entity.x} y={entity.y} width={entity.width} height={height}/>
      : <EntityPreset entity={{ ...entity, height }}/>)}
    {warning && <>
      <g className="skyline-glider__shutter-warning">
        <HazardStrip x={stripX} y={entity.y} width={stripWidth}/>
        <HazardStrip x={stripX} y={entity.y + entity.height} width={stripWidth}/>
      </g>
      {/* Above the gap, clear of the glider flying through it. */}
      <Callout role="boost" centre={entity.x + entity.width / 2} bottom={entity.y - 6 * U}/>
    </>}
  </g>;
}

function Entity({ entity, assets, time, role, damage, flashKey }) {
  const name = frameName(entity, time);
  return <g data-testid={`course-entity-${entity.id}`} data-class={entity.class} data-role={role} className={`skyline-glider__entity skyline-glider__entity--${entity.class} skyline-glider__entity--${role}`}>
    {entity.slices && hasFrame(assets, entity.slices.body)
      ? <SlicedSprite id={entity.id} assets={assets} slices={entity.slices} x={entity.x} y={entity.y} width={entity.width} height={entity.height}/>
      : hasFrame(assets, name)
        ? <SpriteFrame assets={assets} name={name} x={entity.x} y={entity.y} width={entity.width} height={entity.height}/>
        : <EntityPreset entity={entity}/>}
    {flashKey && <rect key={flashKey} className="skyline-glider__entity-flash" x={entity.x} y={entity.y} width={entity.width} height={entity.height}/>}
    {role === 'shoot' && <TargetMarks entity={entity} damage={damage}/>}
    {CALLOUT[role] && <Callout role={role} centre={entity.x + entity.width / 2} bottom={entity.y - 3 * U}/>}
  </g>;
}

// Square debris flung out from a point: [x, y, size] in scene units.
const KILL_CHUNKS = Object.freeze([[0, -33, 9], [24, -24, 6], [33, 0, 9], [24, 24, 6], [0, 33, 9], [-24, 24, 6], [-33, 0, 9], [-24, -24, 6]]);
const CRASH_CHUNKS = Object.freeze([[-66, -36, 9], [-84, -54, 6], [-72, 0, 9], [-96, 0, 6], [-60, 33, 9], [-78, 48, 6], [45, -30, 9], [63, -45, 6], [60, 15, 9], [84, 24, 6]]);
const Chunks = ({ list }) => list.map(([x, y, size], index) => <rect key={index} data-odd={index % 2 ? 'true' : 'false'} x={x - size / 2} y={y - size / 2} width={size} height={size}/>);
// A stepped four-point spark, `r` pixels from centre to tip.
const spark = (cx, cy) => `M${cx - U} ${cy - 3 * U}h${2 * U}v${2 * U}h${2 * U}v${2 * U}h${-2 * U}v${2 * U}h${-2 * U}v${-2 * U}h${-2 * U}v${-2 * U}h${2 * U}Z`;

// A landed shot: a kill throws debris and floats "+1", a hit that did not kill
// sparks, and a shot something shrugged off puffs grey.
function Impact({ impact, x, y }) {
  return <g data-testid={`skyline-glider-impact-${impact.id}`} data-effect={impact.effect} transform={`translate(${x} ${y})`} className={`skyline-glider__impact skyline-glider__impact--${impact.effect}`}>
    {impact.effect === 'kill' ? <>
      <g className="skyline-glider__impact-burst"><path d={spark(0, 0)}/><Chunks list={KILL_CHUNKS}/></g>
      {impact.scores !== false && <text y={-18 * U} textAnchor="middle">+1</text>}
    </> : <g className="skyline-glider__impact-pop">{impact.effect === 'damage' ? <path d={spark(0, 0)}/> : <Chunks list={[[-6, -3, 6], [3, -9, 6], [6, 6, 6]]}/>}</g>}
  </g>;
}

const SHOT_SIZE = Object.freeze({ laser: { width: 52, height: 14 }, bomb: { width: 24, height: 30 }, missile: {width:42,height:16} });

function Shot({ shot, x, y, zone, assets, time }) {
  const name = frameName(zone.weapons?.[shot.kind], time);
  const size = SHOT_SIZE[shot.kind] || SHOT_SIZE.bomb;
  // A laser sprite is pinned by its tip to the shot's point (right-aligned, so
  // any frame aspect ratio keeps the tip there); a bomb sprite is centred.
  const laser = shot.kind === 'laser';
  const left = laser ? -size.width : -size.width / 2;
  return <g data-testid={`skyline-glider-shot-${shot.id}`} data-kind={shot.kind} data-power={shot.power || 1} transform={`translate(${x} ${y})`} className={`skyline-glider__shot skyline-glider__shot--${shot.kind}`}>
    {hasFrame(assets, name)
      ? <SpriteFrame assets={assets} name={name} x={left} y={-size.height / 2} width={size.width} height={size.height} align={laser ? 'xMaxYMid' : 'xMidYMid'}/>
      : laser ? <LaserPreset/> : shot.kind==='missile'?<g><path data-missile-body="" d="M-20 -7 H9 L24 0 9 7 H-20 L-12 0Z" fill="#fff2bf" stroke="#67462f" strokeWidth="2"/><path d="M-20 -4 L-36 0 -20 4" fill="#ef7b38"/></g>:<BombPreset/>}
  </g>;
}

// Blasts step through their frames by progress, not by clock time.
function blastFrame(spec, progress) {
  const frames = spec?.frames || (spec?.frame ? [spec.frame] : []);
  return frames.length ? frames[Math.min(frames.length - 1, Math.floor(progress * frames.length))] : null;
}

function Blast({ blast, x, y, width, height, progress, zone, assets }) {
  const name = blastFrame(zone.weapons?.blast, progress);
  return <g data-testid={`skyline-glider-blast-${blast.id}`} data-progress={Math.round(progress * 100) / 100} transform={`translate(${x} ${y})`} className="skyline-glider__blast">
    {hasFrame(assets, name)
      ? <SpriteFrame assets={assets} name={name} x={-width / 2} y={-height / 2} width={width} height={height} align="xMidYMid"/>
      : <BlastPreset width={width} height={height} progress={progress}/>}
  </g>;
}

export function FlightScene({ state, course, effects = {}, assets = EMPTY_ZONE_ASSETS }) {
  const zone = course.zone || DEFAULT_ZONE;
  // The camera scrolls steadily; a boost moves the craft ahead of it on screen
  // (state.courseTime is the craft, cameraTime is the view).
  const time = cameraTime(state);
  const projected = projectCourseWindow(course, time);
  const scroll = time * projected.unitsPerSecond;
  const craftX = projected.playerX + (state.courseTime - time) * projected.unitsPerSecond;
  const craftY = state.altitude * projected.height;
  const pitch = clamp((state.verticalRate || 0) * 50, -12, 12);
  const craftFront = SKYLINE_CRAFT_GEOMETRY.frontSeconds * projected.unitsPerSecond;
  const craftRear = SKYLINE_CRAFT_GEOMETRY.rearSeconds * projected.unitsPerSecond;
  const craftFrame = frameName(zone.craft, time);
  const collectibleFrame = frameName(zone.collectible, time);
  const collected = new Set(state.collectedIds || []);
  const destroyed = new Set(state.destroyedIds || []);
  const layers = zone.layers || [];
  const fill = assets.images.get(zone.terrain?.fill);
  const rules = weaponRules(course);
  const xAt = (atSeconds) => projected.playerX + (atSeconds - time) * projected.unitsPerSecond;
  const flashes = new Map((state.impacts || []).filter((impact) => impact.entityId && impact.effect === 'damage').map((impact) => [impact.entityId, impact.id]));
  const blastProgress = (blast) => (rules.blast_s > 0 ? clamp(1 - blast.remaining / rules.blast_s, 0, 1) : 1);
  return <PixelScale.Provider value={zone.pixel_scale || null}><svg className={`skyline-glider__scene${zone.pixel_art ? ' skyline-glider__scene--pixel' : ''}`} data-zone={zone.id} data-theme={zone.palette?.theme || "alpine"} viewBox={`0 0 ${SCENE_WIDTH} ${SCENE_HEIGHT}`} role="img" aria-label={`${zone.name || 'Alpine'} flight course`}>
    <SceneDefs palette={zone.palette}/>
    {fill && <defs>
      <pattern id="glider-terrain-fill" patternUnits="userSpaceOnUse" width={fill.width} height={fill.height} patternTransform={`translate(${-(scroll % fill.width)} 0)`}>
        <image href={fill.url} width={fill.width} height={fill.height}/>
      </pattern>
    </defs>}
    {layers.filter((layer) => !layer.front).map((layer) => <Layer key={layer.id} layer={layer} assets={assets} scroll={scroll}/>)}
    <g className="skyline-glider__course-geometry">
      {projected.segments.map((segment) => <CourseSegment key={segment.id} segment={segment} zone={zone} assets={assets} time={time}/>)}
      {projected.entities.filter((entity) => !destroyed.has(entity.id)).map((entity) => entity.closes_at_s != null
        ? <Shutter key={entity.id} entity={entity} assets={assets} progress={shutterProgress(entity, time)}/>
        : <Entity key={entity.id} entity={entity} assets={assets} time={time}
          role={entityRole(entity, !!rules.enabled)} damage={state.entityDamage?.[entity.id]} flashKey={flashes.get(entity.id)}/>)}
      {projected.collectibles.filter((item) => !collected.has(item.id)).map((item) => <g key={item.id} transform={`translate(${item.x} ${item.y})`} className="skyline-glider__bell" data-testid={`course-collectible-${item.id}`}>
        {hasFrame(assets, collectibleFrame) ? <SpriteFrame assets={assets} name={collectibleFrame} x={-16} y={-16} width={32} height={32} align="xMidYMid"/> : <BellPreset/>}
      </g>)}
    </g>
    <g className="skyline-glider__weapons">
      {(state.projectiles || []).map((shot) => <Shot key={shot.id} shot={shot} x={xAt(shot.at_s)} y={shot.altitude * projected.height} zone={zone} assets={assets} time={time}/>)}
    </g>
    <g className="skyline-glider__wind" transform={`translate(${craftX - 72} ${craftY})`}><path d="M0 -15 h42 M-18 0 h54 M6 15 h30"/></g>
    <g data-testid="skyline-glider-craft" data-facing="right" data-front-seconds={SKYLINE_CRAFT_GEOMETRY.frontSeconds} data-rear-seconds={SKYLINE_CRAFT_GEOMETRY.rearSeconds} data-radius={SKYLINE_CRAFT_GEOMETRY.radius} transform={`translate(${craftX} ${craftY}) rotate(${pitch})`} className="skyline-glider__craft">
      {hasFrame(assets, craftFrame) ? (() => {
        const height = Number(zone.craft.height ?? 0.09) * SCENE_HEIGHT;
        return <SpriteFrame assets={assets} name={craftFrame} x={-craftRear} y={-height / 2} width={craftFront + craftRear} height={height} align="xMidYMid"/>;
      })() : <GliderPreset craftFront={craftFront} craftRear={craftRear}/>}
    </g>
    {/* Drawn beside the craft, not inside it: the craft's own shadow and pitch stay off them. */}
    <g className="skyline-glider__craft-effects" transform={`translate(${craftX} ${craftY})`}>
      {(effects.collisionKey || state.invincibleRemaining > 0) && <g key={effects.collisionKey || 'protected'} data-testid="skyline-glider-collision-effect" className="skyline-glider__collision-burst"><Chunks list={CRASH_CHUNKS}/></g>}
      {state.boostRemaining>0&&<g data-testid="skyline-glider-boost-effect" className="skyline-glider__boost-trail"><path className="skyline-glider__boost-trail-rim" d="M-42 -9 h-42 M-45 6 h-66 M-39 21 h-51"/><path d="M-45 -9 h-36 M-48 6 h-60 M-42 21 h-45"/></g>}
      {(effects.pops || []).map((pop) => <g key={pop.key} className="skyline-glider__bell-pop"><path d={spark(0, -30) + spark(30, 0) + spark(0, 30) + spark(-30, 0)}/></g>)}
    </g>
    {(state.blasts || []).map((blast) => <Blast key={blast.id} blast={blast} x={xAt(blast.at_s)} y={blast.altitude * projected.height} width={(blast.blast_width_s ?? rules.blast_width_s) * projected.unitsPerSecond} height={(blast.blast_height ?? rules.blast_height) * projected.height} progress={blastProgress(blast)} zone={zone} assets={assets}/>)}
    <g className="skyline-glider__impacts">
      {(state.impacts || []).map((impact) => <Impact key={impact.id} impact={impact} x={xAt(impact.at_s)} y={impact.altitude * projected.height}/>)}
    </g>
    {layers.filter((layer) => layer.front).map((layer) => <Layer key={layer.id} layer={layer} assets={assets} scroll={scroll}/>)}
  </svg></PixelScale.Provider>;
}

export default FlightScene;
