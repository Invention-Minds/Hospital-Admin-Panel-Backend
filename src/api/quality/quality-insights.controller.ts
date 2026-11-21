import type { Request, Response } from 'express';
import moment from 'moment-timezone';
import { HOSPITAL_TZ } from './quality-input.util';
import { getClusters, getHeatmap, getTrends, isMonthKey } from './quality-insights';

// Quality insights — Units heat-map, 12-month Trends, pattern alerts.
// Results are cached for 10 minutes; ?fresh=1 recomputes.

const fresh = (req: Request): boolean => req.query['fresh'] === '1' || req.query['fresh'] === 'true';

export const qualityTrends = async (req: Request, res: Response): Promise<void> => {
  try {
    res.status(200).json({ data: await getTrends(fresh(req)) });
  } catch (error) {
    console.error('[quality-insights] trends failed:', error);
    res.status(500).json({ message: 'Failed to load trends' });
  }
};

export const qualityUnitsHeatmap = async (req: Request, res: Response): Promise<void> => {
  try {
    const raw = req.query['month'];
    const current = moment.tz(HOSPITAL_TZ).format('YYYY-MM');
    if (raw !== undefined && !isMonthKey(raw)) {
      res.status(400).json({ message: 'month must be YYYY-MM' });
      return;
    }
    const month = (raw as string | undefined) ?? current;
    if (month > current) {
      res.status(400).json({ message: 'month cannot be in the future' });
      return;
    }
    res.status(200).json({ data: await getHeatmap(month, fresh(req)) });
  } catch (error) {
    console.error('[quality-insights] heatmap failed:', error);
    res.status(500).json({ message: 'Failed to load the unit heat-map' });
  }
};

export const qualityClusters = async (req: Request, res: Response): Promise<void> => {
  try {
    res.status(200).json({ data: await getClusters(fresh(req)) });
  } catch (error) {
    console.error('[quality-insights] clusters failed:', error);
    res.status(500).json({ message: 'Failed to load pattern alerts' });
  }
};
