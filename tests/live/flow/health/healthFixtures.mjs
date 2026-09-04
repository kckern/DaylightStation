/** Browser journeys never mutate the household. HTTP persistence has its own isolated suite. */
export async function installHealthFixtures(page, { items = [], foods = [] } = {}) {
  const state = { items: structuredClone(items), foods: structuredClone(foods), requests: [], unexpected: [], deleted: new Map(), holdCapture: null };
  const budget = date => {
    const food = state.items.filter(row => row.date === date).reduce((sum, row) => sum + row.calories, 0);
    return { budget: 2000, food, exercise: 0, remaining: 2000 - food, status: 'under', macros: {}, sessions: [] };
  };
  const add = (food, body) => {
    const row = { ...food, uuid: `fixture-row-${state.requests.length}`, version: 1, foodId: food.id,
      date: body.date, mealTime: body.bucket || body.mealTime, settled: false };
    state.items.push(row);
    return { committed: true, logged: true, item: row, entryIds: [row.uuid], date: row.date, mealTime: row.mealTime };
  };
  await page.route('**/api/**', route => {
    // Vite also serves source modules from directories named /api/.
    if (!new URL(route.request().url()).pathname.startsWith('/api/')) return route.fallback();
    if (route.request().method() !== 'GET') state.unexpected.push({
      url: route.request().url(), method: route.request().method(), body: route.request().postData(),
    });
    return route.fulfill({ json: {} });
  });
  await page.route('**/api/v1/health/**', async route => {
    const request = route.request(), url = new URL(request.url()), endpoint = url.pathname.replace('/api/v1/health', '');
    const method = request.method();
    const body = method === 'GET' ? null : request.postDataJSON();
    state.requests.push({ endpoint, method, body });
    const reply = json => route.fulfill({ json });
    if (method === 'GET') {
      if (endpoint === '/context') return reply({ userId: 'health-fixture' });
      if (endpoint === '/goals') return reply({ goals: null });
      if (endpoint === '/day') return reply({ date: url.searchParams.get('date'), items: state.items.filter(row => row.date === url.searchParams.get('date')), budget: budget(url.searchParams.get('date')), revision: state.requests.length });
      if (endpoint === '/budget/range') return reply({ days: [] });
      if (endpoint === '/nutrition/catalog/suggest') return reply({ items: state.foods.map(food => ({ ...food, nutrients: food })) });
      if (endpoint.startsWith('/nutrition/catalog/')) {
        const food = state.foods.find(food => food.id === endpoint.split('/').at(-1));
        return food ? reply({ entry: food }) : route.fulfill({ status: 404, json: { error: 'Saved food no longer exists' } });
      }
      if (endpoint === '/nutrition/pending') return reply({ pending: [] });
      if (endpoint === '/nutrition/observations') return reply({ observations: [] });
      if (endpoint === '/nutrition/templates') return reply({ templates: [] });
      if (endpoint === '/medical') return reply({ metrics: [] });
      return reply({});
    }
    if (method === 'PUT' && endpoint === '/nutrition/catalog/favorite') {
      const food = state.foods.find(food => body.id ? food.id === body.id : food.name === body.name);
      if (!food) return route.fulfill({ status: 404, json: { error: 'Fixture food not found' } });
      food.favorite = body.favorite;
      return reply({ entry: food });
    }
    if (method === 'POST' && endpoint === '/nutrition/catalog') {
      const food = { ...body, id: 'fixture-food', upc: body.barcodeUpc, grams: body.grams };
      state.foods.push(food); return reply({ entry: food });
    }
    if (method === 'POST' && endpoint === '/nutrition/catalog/quickadd') {
      const food = state.foods.find(food => food.id === body.catalogEntryId);
      return food ? reply(add(food, body)) : route.fulfill({ status: 404, json: { error: 'Fixture food not found' } });
    }
    if (method === 'POST' && endpoint === '/nutrition/input') {
      if (state.holdCapture) await state.holdCapture;
      if (body.type === 'barcode') {
        const food = state.foods.find(food => food.upc === body.content);
        return reply(food ? add(food, body) : { committed: false, unknownUpc: true, upc: body.content });
      }
      return reply(add({ name: 'Captured eggs', grams: 100, calories: 150, protein: 12, carbs: 2, fat: 10 }, body));
    }
    if (endpoint.startsWith('/nutrilist/')) {
      const id = endpoint.split('/').at(-1), row = state.items.find(row => row.uuid === id);
      if (!row) return route.fulfill({ status: 404, json: { error: 'Fixture row not found' } });
      if (method === 'DELETE') {
        state.deleted.set(id, row); state.items = state.items.filter(row => row.uuid !== id);
        return reply({ affectedIds: [id], affectedDates: [row.date] });
      }
      if (method === 'PUT') { Object.assign(row, body, { version: row.version + 1 }); return reply({ data: row, cascadedIds: [], affectedIds: [id] }); }
    }
    if (method === 'POST' && endpoint === '/nutrition/restore') {
      for (const id of body.entryIds) if (state.deleted.has(id)) { state.items.push(state.deleted.get(id)); state.deleted.delete(id); }
      return reply({ committed: true });
    }
    state.unexpected.push({ endpoint, method });
    return route.fulfill({ status: 500, json: { error: 'Unowned fixture mutation' } });
  });
  return state;
}
