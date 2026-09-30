"""JSON protocol adapter. Configuration is supplied by the platform launcher."""
import argparse
import json
from pathlib import Path

from engine import Engine
from runtime_core import Rejected


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--request', type=Path)
    parser.add_argument('--execute', metavar='RUN_ID')
    parser.add_argument('--tool', choices=['render-figure', 'record-visual-review'])
    parser.add_argument('--review', type=Path)
    parser.add_argument('--history', type=Path)
    args = parser.parse_args()
    config = json.loads(args.config.read_text(encoding='utf-8-sig'))
    engine = Engine(config)
    try:
        if args.history:
            result = engine.history(args.history)
        elif args.execute:
            result = engine.execute_claimed(args.execute, args.tool, json.loads(args.review.read_text(encoding='utf-8')) if args.review else None)
        elif args.request:
            request = engine.c.read(args.request)
            result = engine.dispatch(request)
        else:
            parser.error('A request, claimed execution or history record is required')
        print(json.dumps(result, ensure_ascii=False))
        return 0 if result.get('ok', True) else 1
    except Rejected as error:
        print(json.dumps({'ok': False, 'error': {'code': error.code, 'message': str(error)}}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
