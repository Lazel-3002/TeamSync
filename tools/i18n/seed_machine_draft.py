"""Generate review-required locale drafts; never use this at application runtime."""
import argparse, json, time
from pathlib import Path
from deep_translator import GoogleTranslator

ROOT = Path(__file__).resolve().parents[2]
CATALOGS = ROOT / 'resources' / 'localization' / 'catalogs'
TARGETS = {'pt-BR': 'pt', 'zh-CN': 'zh-CN'}

def load(locale):
    return json.loads((CATALOGS / f'{locale}.json').read_text(encoding='utf-8'))

def save(locale, data):
    (CATALOGS / f'{locale}.json').write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

def run(locale, section):
    catalog, english = load(locale), load('en')
    target = TARGETS.get(locale, locale)
    translator = GoogleTranslator(source='en', target=target)
    work = []
    if section in ('structured', 'all'):
        work += [('structured', key, english['structured'][key]) for key, value in catalog['structured'].items() if not value.strip()]
    if section in ('legacy', 'all'):
        work += [('legacy', key, key) for key, value in catalog['legacy'].items() if not value.strip()]
    separator = '\n__TEAMSYNC_LOCALE_SEPARATOR_9A4F__\n'
    for offset in range(0, len(work), 8):
        batch = work[offset:offset + 8]
        group = batch[0][0]
        source = 'tr' if group == 'legacy' else 'en'
        translator = GoogleTranslator(source=source, target=target)
        source_text = separator.join(item[2] for item in batch)
        try:
            translated = translator.translate(source_text).split(separator)
            if len(translated) != len(batch):
                raise ValueError('translation separator was changed')
        except Exception:
            translated = []
            for _, key, value in batch:
                try:
                    translated.append(GoogleTranslator(source=source, target=target).translate(value))
                except Exception:
                    # A provider occasionally rejects an isolated short label
                    # (for example Turkish "Git").  Do not leave Turkish in a
                    # selectable locale: retain the reviewed English fallback
                    # and flag the catalogue as a machine draft for review.
                    translated.append(english[group].get(key, value))
        for (_, key, _), translation in zip(batch, translated):
            catalog[group][key] = translation
        completed = min(offset + len(batch), len(work))
        save(locale, catalog)
        print(f'{locale} {section}: {completed}/{len(work)}', flush=True)
        time.sleep(0.12)
    catalog['status'] = 'machine-draft'
    catalog['machineDraft'] = {'provider': 'Google Translate via deep-translator', 'reviewRequired': True}
    save(locale, catalog)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--locale', required=True)
    parser.add_argument('--section', choices=['structured', 'legacy', 'all'], default='all')
    args = parser.parse_args()
    run(args.locale, args.section)
