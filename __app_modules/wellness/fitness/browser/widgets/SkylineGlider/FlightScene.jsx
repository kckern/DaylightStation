import React from 'react';
import { projectCourseWindow } from "../../lib/skylineGlider/courseProjection.js";
import { SKYLINE_CRAFT_GEOMETRY } from "../../lib/skylineGlider/flightGeometry.js";
import { weaponRules } from "../../lib/skylineGlider/weapons.js";
import { EMPTY_ZONE_ASSETS } from "../../lib/skylineGlider/zoneAssets.js";
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

function SpriteFrame({ assets, name, x, y, width, height, align = 'xMidYMax' }) {
  const frame = assets.frames?.[name];
  if (!frame || !assets.sheet) return null;
  return <svg x={x} y={y} width={width} height={height} viewBox={`${frame.x} ${frame.y} ${frame.w} ${frame.h}`} preserveAspectRatio={`${align} meet`}>
    <image href={assets.sheet.url} width={assets.sheet.width} height={assets.sheet.height}/>
  </svg>;
}

const hasFrame = (assets, name) => !!(name && assets.sheet && assets.frames?.[name]);

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
    {fill || edge || ceilingEdge
      ? <SkinnedTerrain segment={segment} terrain={terrain} fill={fill} edge={edge} ceilingEdge={ceilingEdge}/>
      : <TerrainPreset segment={segment}/>}
  </g>;
}

function Entity({ entity, assets, time }) {
  const name = frameName(entity, time);
  return <g data-testid={`course-entity-${entity.id}`} data-class={entity.class} className={`skyline-glider__entity skyline-glider__entity--${entity.class}`}>
    {hasFrame(assets, name)
      ? <SpriteFrame assets={assets} name={name} x={entity.x} y={entity.y} width={entity.width} height={entity.height}/>
      : <EntityPreset entity={entity}/>}
  </g>;
}

const SHOT_SIZE = Object.freeze({ laser: { width: 52, height: 14 }, bomb: { width: 24, height: 30 } });

function Shot({ shot, x, y, zone, assets, time }) {
  const name = frameName(zone.weapons?.[shot.kind], time);
  const size = SHOT_SIZE[shot.kind] || SHOT_SIZE.bomb;
  // A laser sprite ends at the tip; a bomb sprite is centred on the bomb.
  const left = shot.kind === 'laser' ? -size.width : -size.width / 2;
  return <g data-testid={`skyline-glider-shot-${shot.id}`} data-kind={shot.kind} transform={`translate(${x} ${y})`} className={`skyline-glider__shot skyline-glider__shot--${shot.kind}`}>
    {hasFrame(assets, name)
      ? <SpriteFrame assets={assets} name={name} x={left} y={-size.height / 2} width={size.width} height={size.height} align="xMidYMid"/>
      : shot.kind === 'laser' ? <LaserPreset/> : <BombPreset/>}
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
  const projected = projectCourseWindow(course, state.courseTime);
  const time = state.courseTime;
  const scroll = time * projected.unitsPerSecond;
  const craftX = projected.playerX;
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
  const xAt = (atSeconds) => craftX + (atSeconds - time) * projected.unitsPerSecond;
  const blastWidth = rules.blast_width_s * projected.unitsPerSecond;
  const blastHeight = rules.blast_height * projected.height;
  const blastProgress = (blast) => (rules.blast_s > 0 ? clamp(1 - blast.remaining / rules.blast_s, 0, 1) : 1);
  return <svg className={`skyline-glider__scene${zone.pixel_art ? ' skyline-glider__scene--pixel' : ''}`} data-zone={zone.id} viewBox={`0 0 ${SCENE_WIDTH} ${SCENE_HEIGHT}`} role="img" aria-label={`${zone.name || 'Alpine'} flight course`}>
    <SceneDefs/>
    {fill && <defs>
      <pattern id="glider-terrain-fill" patternUnits="userSpaceOnUse" width={fill.width} height={fill.height} patternTransform={`translate(${-(scroll % fill.width)} 0)`}>
        <image href={fill.url} width={fill.width} height={fill.height}/>
      </pattern>
    </defs>}
    {layers.filter((layer) => !layer.front).map((layer) => <Layer key={layer.id} layer={layer} assets={assets} scroll={scroll}/>)}
    <g className="skyline-glider__course-geometry">
      {projected.segments.map((segment) => <CourseSegment key={segment.id} segment={segment} zone={zone} assets={assets} time={time}/>)}
      {projected.entities.filter((entity) => !destroyed.has(entity.id)).map((entity) => <Entity key={entity.id} entity={entity} assets={assets} time={time}/>)}
      {projected.collectibles.filter((item) => !collected.has(item.id)).map((item) => <g key={item.id} transform={`translate(${item.x} ${item.y})`} className="skyline-glider__bell" data-testid={`course-collectible-${item.id}`}>
        {hasFrame(assets, collectibleFrame) ? <SpriteFrame assets={assets} name={collectibleFrame} x={-16} y={-16} width={32} height={32} align="xMidYMid"/> : <BellPreset/>}
      </g>)}
    </g>
    <g className="skyline-glider__weapons">
      {(state.projectiles || []).map((shot) => <Shot key={shot.id} shot={shot} x={xAt(shot.at_s)} y={shot.altitude * projected.height} zone={zone} assets={assets} time={time}/>)}
    </g>
    <g className="skyline-glider__wind" transform={`translate(${craftX - 72} ${craftY})`}><path d="M0 -14 h42 M-18 0 h55 M5 14 h32"/></g>
    <g data-testid="skyline-glider-craft" data-facing="right" data-front-seconds={SKYLINE_CRAFT_GEOMETRY.frontSeconds} data-rear-seconds={SKYLINE_CRAFT_GEOMETRY.rearSeconds} data-radius={SKYLINE_CRAFT_GEOMETRY.radius} transform={`translate(${craftX} ${craftY}) rotate(${pitch})`} className="skyline-glider__craft">
      {hasFrame(assets, craftFrame) ? (() => {
        const height = Number(zone.craft.height ?? 0.09) * SCENE_HEIGHT;
        return <SpriteFrame assets={assets} name={craftFrame} x={-craftRear} y={-height / 2} width={craftFront + craftRear} height={height} align="xMidYMid"/>;
      })() : <GliderPreset craftFront={craftFront} craftRear={craftRear}/>}
      {(effects.collisionKey || state.invincibleRemaining > 0) && <g key={effects.collisionKey || 'protected'} data-testid="skyline-glider-collision-effect" className="skyline-glider__collision-burst"><path d="M-62 -34 l-16 -18 M-67 0 h-28 M-55 31 l-20 16 M43 -28 l18 -16 M57 15 l25 8"/></g>}
      {(effects.pops || []).map((pop) => <g key={pop.key} className="skyline-glider__bell-pop"><circle r="28"/><path d="M-30 0 H30 M0 -30 V30"/></g>)}
    </g>
    {(state.blasts || []).map((blast) => <Blast key={blast.id} blast={blast} x={xAt(blast.at_s)} y={blast.altitude * projected.height} width={blastWidth} height={blastHeight} progress={blastProgress(blast)} zone={zone} assets={assets}/>)}
    {layers.filter((layer) => layer.front).map((layer) => <Layer key={layer.id} layer={layer} assets={assets} scroll={scroll}/>)}
  </svg>;
}

export default FlightScene;
