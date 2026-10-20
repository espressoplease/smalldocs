'use strict';

const { USERS } = require('./corpus');

function requestFor(scenario, context, overrides) {
  const userId = scenario.userId || USERS.reader;
  const names = scenario.workspace ? [scenario.workspace] : context.memberships[userId] || [];
  const request = {
    userId, expression: scenario.expression,
    workspaceIds: names.map((name) => context.workspaces[name]),
    tags: scenario.tags, tagsAny: scenario.tagsAny, tagsNone: scenario.tagsNone,
    authorUserIds: scenario.authors, updatedByUserIds: scenario.updatedBy,
    documentIds: scenario.documentIds, sharedWithMe: scenario.sharedWithMe,
    createdAfter: scenario.createdAfter ? new Date(scenario.createdAfter).toISOString() : undefined,
    createdBefore: scenario.createdBefore ? new Date(scenario.createdBefore).toISOString() : undefined,
    updatedAfter: scenario.updatedAfter ? new Date(scenario.updatedAfter).toISOString() : undefined,
    updatedBefore: scenario.updatedBefore ? new Date(scenario.updatedBefore).toISOString() : undefined,
    fields: scenario.fields, sort: scenario.sort || 'relevance',
    limit: 100, facets: ['tags', 'authors', 'libraries'], facetLimit: 50,
  };
  if (scenario.project != null) {
    if (!scenario.workspace) throw new Error('A project scenario must name its workspace');
    request.projectId = context.projects[scenario.workspace][scenario.project];
  }
  return { ...request, ...overrides };
}

function createAdapter(context) {
  const { store } = context;
  if (typeof store.searchPage !== 'function') {
    throw new Error('The rich search evaluation requires CloudStore.searchPage');
  }
  return {
    search: (request) => store.searchPage(request),
    requestFor: (scenario, overrides) => requestFor(scenario, context, overrides),
    async rebuild() {
      if (typeof store.rebuildSearchIndex !== 'function') {
        throw new Error('CloudStore.rebuildSearchIndex is not available');
      }
      return store.rebuildSearchIndex({});
    },
  };
}

module.exports = { createAdapter, requestFor };
