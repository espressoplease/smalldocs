(function (exports) {
  var PRICES = {
    personal: { GBP: '£4', USD: '$5', EUR: '€5' },
    team: { GBP: '£7', USD: '$9', EUR: '€8' },
  };

  var EURO_REGIONS = new Set([
    'AT', 'BE', 'HR', 'CY', 'EE', 'FI', 'FR', 'DE', 'GR', 'IE',
    'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PT', 'SK', 'SI', 'ES',
  ]);

  function regionFromLocale(locale) {
    if (!locale || typeof locale !== 'string') return '';
    try {
      return new Intl.Locale(locale.replace(/_/g, '-')).region || '';
    } catch (_error) {
      var parts = locale.replace(/_/g, '-').split('-');
      for (var index = 1; index < parts.length; index += 1) {
        if (/^[A-Za-z]{2}$/.test(parts[index])) return parts[index].toUpperCase();
      }
      return '';
    }
  }

  function currencyForLocales(locales) {
    var values = Array.isArray(locales) ? locales : [locales];
    for (var index = 0; index < values.length; index += 1) {
      var region = regionFromLocale(values[index]);
      if (!region) continue;
      if (region === 'GB') return 'GBP';
      if (EURO_REGIONS.has(region)) return 'EUR';
      return 'USD';
    }
    return 'GBP';
  }

  function currentCurrency() {
    if (typeof navigator === 'undefined') return 'GBP';
    return currencyForLocales(navigator.languages && navigator.languages.length
      ? navigator.languages
      : navigator.language);
  }

  function primaryAmount(plan, currency) {
    var prices = PRICES[plan] || PRICES.personal;
    return prices[currency] || prices.GBP;
  }

  function alternativesText(plan, currency) {
    var prices = PRICES[plan] || PRICES.personal;
    return ['GBP', 'USD', 'EUR']
      .filter(function (code) { return code !== currency; })
      .map(function (code) { return prices[code] + ' ' + code; })
      .join(' or ');
  }

  function planSentence(plan, currency) {
    var selectedCurrency = currency || currentCurrency();
    if (plan === 'team') {
      return primaryAmount('team', selectedCurrency) +
        ' per member each month. Invite people and set access after payment.';
    }
    return primaryAmount('personal', selectedCurrency) +
      ' each month. Documents start with access for you only.';
  }

  function applyPricing(root, currency) {
    var container = root || document;
    var selectedCurrency = currency || currentCurrency();
    container.querySelectorAll('[data-cloud-plan]').forEach(function (planElement) {
      var plan = planElement.getAttribute('data-cloud-plan');
      var primary = planElement.querySelector('[data-cloud-price-primary]');
      var alternatives = planElement.querySelector('[data-cloud-price-alternatives]');
      if (primary) primary.textContent = primaryAmount(plan, selectedCurrency);
      if (alternatives) alternatives.textContent = alternativesText(plan, selectedCurrency);
    });
    return selectedCurrency;
  }

  exports.PRICES = PRICES;
  exports.regionFromLocale = regionFromLocale;
  exports.currencyForLocales = currencyForLocales;
  exports.currentCurrency = currentCurrency;
  exports.primaryAmount = primaryAmount;
  exports.alternativesText = alternativesText;
  exports.planSentence = planSentence;
  exports.applyPricing = applyPricing;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { applyPricing(document); });
    } else {
      applyPricing(document);
    }
  }
})(typeof module !== 'undefined' && module.exports
  ? module.exports
  : (window.SDocsCloudPricing = {}));
