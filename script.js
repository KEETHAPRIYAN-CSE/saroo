const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const state = { itinerary: null, destination: '', language: localStorage.getItem('roamly-language') || 'en', trip: null };
let toastTimer;

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 4200);
}
function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
function money(value) {
  return new Intl.NumberFormat(state.language === 'en' ? 'en-IN' : state.language === 'hi' ? 'hi-IN' : 'ta-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(value) || 0);
}
function translate(key) {
  return window.translations?.[key] || key;
}
async function setLanguage(language) {
  try {
    const response = await fetch(`/api/languages/${encodeURIComponent(language)}`);
    if (!response.ok) throw new Error('Language file could not be loaded.');
    const dictionary = await response.json();
    state.language = language;
    window.translations = dictionary;
    localStorage.setItem('roamly-language', language);
    document.documentElement.lang = language;
    $$('[data-i18n]').forEach((element) => {
      const value = dictionary[element.dataset.i18n];
      if (value) element.innerHTML = value;
    });
    $$('[data-i18n-placeholder]').forEach((element) => {
      const value = dictionary[element.dataset.i18nPlaceholder];
      if (value) element.placeholder = value;
    });
    $('#languageSelect').value = language;
    if (state.itinerary) renderItinerary(state.itinerary, state.trip);
    if (state.destination) $('#headingDestination').textContent = state.destination;
  } catch (error) {
    showToast(error.message);
  }
}
function setDefaultDates() {
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() + 14);
  const end = new Date(start);
  end.setDate(start.getDate() + 3);
  const format = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  $('#startDate').min = format(today);
  $('#endDate').min = format(today);
  $('#startDate').value = format(start);
  $('#endDate').value = format(end);
}
function getErrorMessage(data, fallback) {
  return data?.error || fallback || translate('error_generic');
}
function setLoading(button, isLoading, label) {
  if (isLoading) {
    button.disabled = true;
    button.dataset.originalText = button.querySelector('span')?.textContent || '';
    const first = button.querySelector('span');
    if (first) first.innerHTML = `${escapeHtml(label)}<span class="loading-dots"></span>`;
  } else {
    button.disabled = false;
    const first = button.querySelector('span');
    if (first) first.textContent = button.dataset.originalText || translate('generate');
  }
}
function getTripPayload() {
  const form = $('#tripForm');
  if (!form.reportValidity()) return null;
  const startDate = $('#startDate').value;
  const endDate = $('#endDate').value;
  if (endDate < startDate) {
    $('#endDate').setCustomValidity(translate('error_dates'));
    $('#endDate').reportValidity();
    $('#endDate').setCustomValidity('');
    return null;
  }
  const budget = Number($('#budget').value);
  const travelers = Number($('#travelers').value);
  if (budget <= 0 || travelers < 1 || travelers > 20) {
    showToast(translate('error_numbers'));
    return null;
  }
  return {
    origin: $('#origin').value.trim(), destination: $('#destination').value.trim(), start_date: startDate,
    end_date: endDate, travelers, budget, interests: $$('.interest-chip.selected').map((chip) => chip.dataset.interest),
    preferences: $('#preferences').value.trim(), language: state.language
  };
}
$('#startDate').addEventListener('change', () => { $('#endDate').min = $('#startDate').value; });
$$('.interest-chip').forEach((button) => button.addEventListener('click', () => {
  button.classList.toggle('selected');
  button.setAttribute('aria-pressed', button.classList.contains('selected'));
}));
$('#languageSelect').addEventListener('change', (event) => setLanguage(event.target.value));

$('#tripForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = getTripPayload();
  if (!payload) return;
  const button = $('#generateButton');
  setLoading(button, true, translate('loading_plan'));
  try {
    const response = await fetch('/api/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) throw new Error(getErrorMessage(data));
    state.trip = payload;
    state.destination = payload.destination;
    state.itinerary = data.itinerary;
    renderItinerary(data.itinerary, payload, data.budget);
    renderRoute(data.route, data.weather, payload);
    $('#resultsSection').classList.remove('hidden');
    $('#assistant').classList.remove('hidden');
    $('#headingDestination').textContent = payload.destination;
    $('#sourceLabel').textContent = data.ai_generated ? translate('ai_generated') : translate('sample_plan');
    $('#weatherDetails').textContent = data.weather?.summary || translate('weather_placeholder');
    $('#weatherAdvice').textContent = data.weather?.advice || '';
    $('#resultsSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    showToast(error.message || translate('error_generic'));
  } finally {
    setLoading(button, false);
  }
});
function renderRoute(route = {}, weather = {}, trip = {}) {
  $('#mapOrigin').textContent = trip.origin || translate('map_start');
  $('#mapDestination').textContent = trip.destination || translate('map_destination');
  $('#mapNote').textContent = route?.source === 'live' ? translate('route_live') : translate('route_sample');
  $('#distanceValue').textContent = route?.distance_km ? `${route.distance_km} km` : '—';
  $('#durationValue').textContent = route?.duration_hours ? `${route.duration_hours} ${translate('hours')}` : '—';
  $('#weatherValue').textContent = weather?.short || '—';
  $('#routeBadge').textContent = route?.mode || translate('route_badge');
  $('#routeDataNote').textContent = route?.note || translate('route_data_note');
}
const activityTime = (time) => ({ morning: translate('morning'), afternoon: translate('afternoon'), evening: translate('evening') }[time] || time || '');
function renderItinerary(itinerary, trip, budgetInfo) {
  if (!itinerary || !Array.isArray(itinerary.days)) return;
  $('#itineraryList').innerHTML = itinerary.days.map((day, index) => `
    <article class="day-card"><div class="day-header"><span class="day-num">${String(index + 1).padStart(2, '0')}</span><div><div class="day-title">${escapeHtml(day.title || `${translate('day')} ${index + 1}`)}</div><div class="day-subtitle">${escapeHtml(day.date || '')}${day.area ? ` · ${escapeHtml(day.area)}` : ''}</div></div><span class="day-cost">${money(day.estimated_cost || 0)}</span></div>
      <div class="day-body">${(day.activities || []).map((activity) => `<div class="activity-item"><span class="activity-time">${escapeHtml(activityTime(activity.time))}</span><div><div class="activity-name">${escapeHtml(activity.name)}</div><div class="activity-detail">${escapeHtml(activity.description || '')}</div></div><span class="activity-cost">${money(activity.cost || 0)}</span></div>`).join('')}</div></article>`).join('');
  const budget = budgetInfo || itinerary.budget || {};
  const total = Number(budget.total ?? budget.estimated_total ?? 0);
  const limit = Number(trip?.budget || $('#budget').value || 0);
  const remaining = limit - total;
  $('#estimatedTotal').textContent = money(total);
  $('#remainingBudget').textContent = `${remaining < 0 ? '−' : ''}${money(Math.abs(remaining))}`;
  $('#remainingBudget').style.color = remaining < 0 ? '#b45645' : '';
  $('#budgetBar').style.width = `${Math.max(0, Math.min(100, limit ? total / limit * 100 : 0))}%`;
  const categories = budget.categories || {};
  const names = { transport: translate('budget_transport'), accommodation: translate('budget_stay'), food: translate('budget_food'), activities: translate('budget_activities') };
  $('#budgetBreakdown').innerHTML = Object.entries(names).map(([key, title]) => `<div class="breakdown-row"><span>${escapeHtml(title)}</span><strong>${money(categories[key] || 0)}</strong></div>`).join('');
}

$('#chatForm').addEventListener('submit', (event) => { event.preventDefault(); sendChat($('#chatInput').value); });
$$('.chat-suggestions button').forEach((button) => button.addEventListener('click', () => sendChat(button.dataset.prompt)));
async function sendChat(message) {
  const text = message.trim();
  if (!text) return;
  if (!state.itinerary || !state.trip) {
    showToast(translate('chat_no_trip'));
    return;
  }
  appendMessage(text, 'user');
  $('#chatInput').value = '';
  const send = $('#chatSend');
  send.disabled = true;
  const placeholder = appendMessage(translate('thinking'), 'assistant');
  try {
    const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text, itinerary: state.itinerary, trip: state.trip, language: state.language }) });
    const data = await response.json();
    if (!response.ok) throw new Error(getErrorMessage(data));
    state.itinerary = data.itinerary;
    renderItinerary(data.itinerary, state.trip, data.budget);
    placeholder.querySelector('p').textContent = data.reply || translate('chat_done');
  } catch (error) {
    placeholder.querySelector('p').textContent = error.message || translate('error_generic');
  } finally {
    send.disabled = false;
  }
}
function appendMessage(text, role) {
  const node = document.createElement('div');
  node.className = `chat-message ${role === 'user' ? 'user-message' : 'assistant-message'}`;
  node.innerHTML = `${role === 'assistant' ? '<span class="chat-avatar">✳</span>' : ''}<p>${escapeHtml(text)}</p>`;
  $('#chatMessages').append(node);
  $('#chatMessages').scrollTop = $('#chatMessages').scrollHeight;
  return node;
}

setDefaultDates();
setLanguage(state.language);
