import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import LearningCatalogBrowser from './LearningCatalogBrowser.jsx';

const learningCatalogs = vi.fn();
const learningLesson = vi.fn();
vi.mock('../schoolApi.js', () => ({ schoolApi: {
  learningCatalogs: (...args) => learningCatalogs(...args),
  learningLesson: (...args) => learningLesson(...args),
} }));
vi.mock('../identity/SchoolProfileContext.jsx', () => ({
  useSchoolProfile: () => ({ status: 'ready', currentUser: { id: 'kid-a' }, isGuest: false }),
}));

const catalog = {
  schema: 'school.catalog/v1', catalogId: 'core', title: 'Core', subjects: [{
    subjectId: 'quant', title: 'Quantitative', courses: [{
      courseId: 'rates', title: 'Rates', units: [{ unitId: 'intro', title: 'Introduction', lessons: [{
        lessonId: 'unit-rate', title: 'Unit rates', modules: [{ moduleId: 'check', type: 'learning_probe' }],
      }] }],
    }],
  }],
};

beforeEach(() => {
  learningCatalogs.mockReset().mockResolvedValue({ ok: true, data: { schema: 'school.catalog-index/v1', catalogs: [catalog] } });
  learningLesson.mockReset().mockResolvedValue({ ok: true, data: {
    schema: 'school.learning-lesson/v1',
    context: { catalog: { catalogId: 'core' }, subject: { subjectId: 'quant' }, course: { courseId: 'rates' }, unit: { unitId: 'intro' } },
    lesson: { lessonId: 'unit-rate', title: 'Unit rates', objectives: ['Compare rates'], modules: [{
      moduleId: 'check', type: 'learning_probe', title: 'Check it', conceptIds: ['unit-rate'], bank: { id: 'rate-check', items: [] },
    }] },
  } });
});

describe('LearningCatalogBrowser', () => {
  it('walks Catalog → subject → course → unit → lesson and launches a hydrated module', async () => {
    const onLaunch = vi.fn();
    render(<LearningCatalogBrowser onLaunch={onLaunch} />);
    for (const label of ['Core', 'Quantitative', 'Rates', 'Introduction', 'Unit rates']) {
      fireEvent.click(await screen.findByRole('button', { name: new RegExp(label, 'i') }));
    }
    expect(await screen.findByText('Compare rates')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Check it/ }));
    expect(learningCatalogs).toHaveBeenCalledWith('kid-a');
    expect(learningLesson).toHaveBeenCalledWith({
      catalogId: 'core', subjectId: 'quant', courseId: 'rates', unitId: 'intro', lessonId: 'unit-rate',
    }, 'kid-a');
    expect(onLaunch).toHaveBeenCalledWith(expect.objectContaining({
      module: expect.objectContaining({ type: 'learning_probe' }),
      learning: expect.objectContaining({ courseId: 'rates', lessonId: 'unit-rate', conceptIds: ['unit-rate'] }),
    }));
  });

  it('keeps browsing available when the Catalog is empty', async () => {
    learningCatalogs.mockResolvedValueOnce({ ok: true, data: { schema: 'school.catalog-index/v1', catalogs: [] } });
    render(<LearningCatalogBrowser onLaunch={() => {}} />);
    expect(await screen.findByText(/Nothing is published/)).toBeInTheDocument();
  });
});
