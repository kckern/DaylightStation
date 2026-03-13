import { StraddleLayout } from './strategies/StraddleLayout.js';
import { StackLayout } from './strategies/StackLayout.js';
import { FanLayout } from './strategies/FanLayout.js';
import { GridLayout } from './strategies/GridLayout.js';

export class StrategySelector {
  constructor(config = {}) {
    this.strategies = {
      straddle: new StraddleLayout({ ...config, avatarRadius: config.avatarRadius || 30 }),
      stack: new StackLayout(config),
      fan: new FanLayout(config),
      grid: new GridLayout(config)
    };
  }

  selectAndApply(cluster) {
    if (!cluster || cluster.length === 0) return [];
    if (cluster.length === 1) {
      // No strategy needed for single element, just pass through
      return [{ ...cluster[0], finalX: cluster[0].x, finalY: cluster[0].y, strategy: 'none' }];
    }

    let strategy;
    if (cluster.length === 2) {
      strategy = this.strategies.straddle;
    } else if (cluster.length <= 4) {
      strategy = this.strategies.stack;
    } else if (cluster.length <= 6) {
      strategy = this.strategies.fan;
    } else {
      strategy = this.strategies.grid;
    }

    return strategy.apply(cluster);
  }
}
