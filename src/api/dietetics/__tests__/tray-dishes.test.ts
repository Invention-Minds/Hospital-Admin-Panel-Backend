jest.mock('../../../service/prisma-client', () => ({ __esModule: true, default: {} }));

import { withBuffer, pastCutoff, dishSuitsDiet } from '../tray-dishes';
import { splitMealName, dishNameAndPortion } from '../dishes.controller';

describe('dishNameAndPortion — a count in brackets becomes the portion', () => {
  it.each([
    ['Chapati (2)', 'Chapati', '2 nos'],
    ['Idli (3 pcs)', 'Idli', '3 pcs'],
    ['Boiled egg (1)', 'Boiled egg', '1 nos'],
    ['Lassi (sweet)', 'Lassi (sweet)', null],
    ['Biscuits (cream-cracker, 4)', 'Biscuits (cream-cracker, 4)', null],
    ['Dal', 'Dal', null],
  ])('"%s"', (part, name, portion) => {
    expect(dishNameAndPortion(part)).toEqual({ name, portion });
  });
});

describe('splitMealName — existing meal names into dishes', () => {
  it.each([
    ['Steamed rice + dal + sabzi', ['Steamed rice', 'Dal', 'Sabzi']],
    ['Masala dosa + chutney', ['Masala dosa', 'Chutney']],
    ['Plain dosa  +sambar', ['Plain dosa', 'Sambar']],
    ['Fruit bowl (apple/papaya/banana)', ['Fruit bowl (apple/papaya/banana)']],
    ['Fruit bowl (apple + papaya) + curd', ['Fruit bowl (apple + papaya)', 'Curd']],
    ['Weak tea (no sugar)', ['Weak tea (no sugar)']],
    ['Idli + + chutney', ['Idli', 'Chutney']],
  ])('"%s"', (name, want) => {
    expect(splitMealName(name)).toEqual(want);
  });
});

describe('withBuffer — kitchen cooks the count plus a margin', () => {
  it.each([
    [34, 5, 36],
    [20, 5, 21],
    [10, 0, 10],
    [1, 5, 2],
    [0, 5, 0],
    [12, -3, 12],
  ])('%s dishes at +%s%% → %s', (count, pct, want) => {
    expect(withBuffer(count, pct)).toBe(want);
  });
});

describe('pastCutoff — when tray changes stop counting', () => {
  const lunch = new Date(2026, 10, 21, 12, 30);
  const breakfast = new Date(2026, 10, 21, 8, 0);
  it('same-day cut-off', () => {
    expect(pastCutoff(lunch, '10:30', new Date(2026, 10, 21, 10, 0))).toBe(false);
    expect(pastCutoff(lunch, '10:30', new Date(2026, 10, 21, 10, 31))).toBe(true);
  });
  it('a cut-off later than the meal means the evening before', () => {
    expect(pastCutoff(breakfast, '21:00', new Date(2026, 10, 20, 20, 0))).toBe(false);
    expect(pastCutoff(breakfast, '21:00', new Date(2026, 10, 20, 21, 5))).toBe(true);
  });
  it('no cut-off set → never late', () => {
    expect(pastCutoff(lunch, null, new Date(2026, 10, 21, 13, 0))).toBe(false);
  });
});

describe('dishSuitsDiet', () => {
  it('a dish with no diets suits every diet', () => {
    expect(dishSuitsDiet({ diets: [] }, 'DM')).toBe(true);
  });
  it('otherwise only the listed diets', () => {
    const brownRice = { diets: [{ dietMasterId: 'DM' }, { dietMasterId: 'CARD' }] };
    expect(dishSuitsDiet(brownRice, 'DM')).toBe(true);
    expect(dishSuitsDiet(brownRice, 'GEN')).toBe(false);
  });
});
