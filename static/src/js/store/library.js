import qs from 'query-string';
import { URN } from '../scaife-viewer';

module.exports = {
  state: {
    textGroups: [],
    textGroupWorks: [],
    textGroupTexts: [],
    textGroupUrns: {},
    allTextGroups: null,
    allTextGroupWorks: null,
    allTextGroupTexts: null,
    sortKind: 'text-group',
    works: [],
    allWorks: null,
    toc: [],
  },
  getters: {
    hydratedTextGroups(state) {
      return state.textGroups.map(textGroup => ({
        ...textGroup,
        urn: textGroup.urn.toString(),
        works: textGroup.works.map(work => ({
          ...state.textGroupUrns[work.urn.toString()],
          urn: work.urn.toString(),
          texts: work.texts.map(text => ({
            ...state.textGroupUrns[text.urn.toString()],
            urn: text.urn.toString(),
          })),
        })),
      }));
    },
    sortedByURN(state, getters) {
      const tmp = [...getters.hydratedTextGroups];
      tmp.sort((a, b) => a.urn.localeCompare(b.urn));
      return tmp;
    },
    sortedByTextGroup(state, getters) {
      const tmp = [...getters.hydratedTextGroups];
      tmp.sort((a, b) => a.label.localeCompare(b.label));
      return tmp;
    },
    hydratedWorks(state) {
      return state.textGroupWorks.map(work => ({
        ...state.textGroupUrns[work.urn.toString()],
        urn: work.urn.toString(),
        textGroup: state.textGroupUrns[work.urn.upTo('textGroup')],
        texts: work.texts.map(text => ({
          ...state.textGroupUrns[text.urn.toString()],
          urn: text.urn.toString(),
        })),
      }));
    },
    sortedByWork(state, getters) {
      const tmp = [...getters.hydratedWorks];
      tmp.sort((a, b) => a.label.localeCompare(b.label));
      return tmp;
    },
  },
  actions: {
    async loadTextGroupList({ commit }) {
      const url = '/library/json/';
      const opts = { headers: { Accept: 'application/json' } };
      const res = await fetch(url, opts);
      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText}`);
      }
      const textInventory = await res.json();
      const textGroups = [];
      const works = [];
      const texts = [];
      const textGroupUrns = {};

      textInventory.text_groups.forEach((textGroup) => {
        const tg = {
          ...textGroup,
          urn: new URN(textGroup.urn),
          works: textGroup.works.map(work => ({
            ...work,
            urn: new URN(work.urn),
            texts: work.texts.map(text => ({
              ...text,
              urn: new URN(text.urn),
            })),
          })),
        };
        textGroups.push(tg);
        textGroupUrns[textGroup.urn] = tg;
      });
      textInventory.works.forEach((work) => {
        const w = {
          ...work,
          urn: new URN(work.urn),
          texts: work.texts.map(text => ({
            ...text,
            urn: new URN(text.urn),
          })),
        };
        works.push(w);
        textGroupUrns[work.urn] = w;
      });
      textInventory.texts.forEach((text) => {
        const t = {
          urn: new URN(text.urn),
          ...text,
        };
        texts.push(t);
        textGroupUrns[text.urn] = t;
      });

      commit('setTextGroups', { textGroups, works, texts });
      commit('setTextGroupUrns', { textGroupUrns });
    },
    filterTextGroups({ state, commit }, query) {
      if (state.allTextGroups) {
        const textGroups = [];
        state.allTextGroups.forEach((textGroup) => {
          if (textGroup.label.toLowerCase().indexOf(query.toLowerCase()) !== -1) {
            textGroups.push(textGroup);
          } else {
            const works = textGroup.works.filter((work) => {
              const { label } = state.textGroupUrns[work.urn.toString()];
              return label.toLowerCase().indexOf(query.toLowerCase()) !== -1;
            });
            if (works.length > 0) {
              textGroups.push({ ...textGroup, works });
            }
          }
        });
        commit('setTextGroups', { textGroups });
      }
    },
    resetTextGroups({ state, commit }) {
      commit('setTextGroups', { textGroups: [...state.allTextGroups] });
    },
    filterTextGroupWorks({ state, commit }, query) {
      if (state.allTextGroupWorks) {
        const works = [];
        state.allTextGroupWorks.forEach((work) => {
          if (work.label.toLowerCase().indexOf(query.toLowerCase()) !== -1) {
            works.push(work);
          } else {
            const { label } = state.textGroupUrns[work.urn.upTo('textGroup')];
            if (label.toLowerCase().indexOf(query.toLowerCase()) !== -1) {
              works.push(work);
            }
          }
        });
        commit('setTextGroups', { works });
      }
    },
    resetTextGroupWorks({ state, commit }) {
      commit('setTextGroups', { works: [...state.allTextGroupWorks] });
    },
    async loadWorkList({ commit }, textGroupUrl) {
      let params;
      let res;
      let vector;

      const opts = { headers: { Accept: 'application/json' } };
      res = await fetch(textGroupUrl, opts);
      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText}`);
      }
      const textGroup = await res.json();

      // To reduce the load on the API, we prepare two vector calls against works
      // and texts.

      // vector for works
      params = qs.stringify({
        e: textGroup.works.map(work => work.urn.replace(`${textGroup.urn}.`, '')),
      });
      const workVectorUrl = `/library/vector/${textGroup.urn}/?${params}`;
      res = await fetch(workVectorUrl);
      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText}`);
      }
      vector = await res.json();
      const workMap = vector.collections;

      // vector for texts
      const e = [];
      textGroup.works.forEach(({ urn: workUrn }) => {
        const work = workMap[workUrn];
        work.texts.forEach(({ urn: textUrn }) => {
          e.push(textUrn.replace(`${textGroup.urn}.`, ''));
        });
      });
      params = qs.stringify({ e });
      const textVectorUrl = `/library/vector/${textGroup.urn}/?${params}`;
      res = await fetch(textVectorUrl);
      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText}`);
      }
      vector = await res.json();
      const textMap = vector.collections;

      // finally prepare the works object to store
      const works = [];
      textGroup.works.forEach(({ urn: workUrn }) => {
        const work = workMap[workUrn];
        works.push({
          ...work,
          texts: work.texts.map(({ urn: textUrn }) => textMap[textUrn]),
        });
      });

      commit('setWorks', works);
    },
    filterWorks({ state, commit }, query) {
      if (state.allWorks) {
        const works = [];
        state.allWorks.forEach((work) => {
          if (work.label.toLowerCase().indexOf(query.toLowerCase()) !== -1) {
            works.push(work);
          }
        });
        commit('setWorks', works);
      }
    },
    resetWorks({ state, commit }) {
      commit('setWorks', [...state.allWorks]);
    },
    async loadTocList({ commit }, textUrl) {
      const opts = { headers: { Accept: 'application/json' } };
      const res = await fetch(textUrl, opts);
      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText}`);
      }
      const text = await res.json();
      commit('setToc', text.toc);
    },
  },
  mutations: {
    setTextGroups(state, { textGroups, works, texts }) {
      if (textGroups !== undefined) {
        if (!state.allTextGroups) {
          state.allTextGroups = [...textGroups];
        }
        state.textGroups = textGroups;
      }
      if (works !== undefined) {
        if (!state.allTextGroupWorks) {
          state.allTextGroupWorks = [...works];
        }
        state.textGroupWorks = works;
      }
      if (texts !== undefined) {
        if (!state.allTextGroupTexts) {
          state.allTextGroupTexts = [...texts];
        }
        state.textGroupTexts = texts;
      }
    },
    setTextGroupUrns(state, { textGroupUrns }) {
      state.textGroupUrns = textGroupUrns;
    },
    setLibrarySort(state, { kind }) {
      state.sortKind = kind;
    },
    setWorks(state, works) {
      if (!state.allWorks) {
        state.allWorks = [...works];
      }
      state.works = works;
    },
    setToc(state, toc) {
      state.toc = toc;
    },
  },
};
