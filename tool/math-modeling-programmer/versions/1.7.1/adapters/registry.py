"""Registry and lightweight suggestion mechanism for common problem patterns."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any


@dataclass(frozen=True)
class Adapter:
    name: str
    label: str
    signals: tuple[str, ...]
    required_fields: tuple[str, ...]
    validation_checks: tuple[str, ...]
    cautions: tuple[str, ...]

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


ADAPTERS = (
    Adapter(
        "network_propagation", "网络与传播", ("网络", "节点", "边", "传播", "社群", "转发"),
        ("node_id", "source", "target", "timestamp"),
        ("主键和边方向检查", "事件顺序检查", "重复随机模拟和区间", "基线策略比较"),
        ("相关观测不能冒充独立重复", "活跃机制和传播概率必须由题意确认"),
    ),
    Adapter(
        "geometry_coverage", "几何与覆盖", ("测线", "海深", "覆盖", "重叠", "坐标", "坡度"),
        ("x", "y", "depth"),
        ("坐标系和单位检查", "小区域网格覆盖核验", "边界和漏测检查", "方向敏感性"),
        ("水平投影和坡面宽度不能混用", "边界覆盖要独立核验"),
    ),
    Adapter(
        "quality_control", "质量控制", ("次品", "抽样", "验收", "成本", "装配", "检测"),
        ("batch_id", "sample_size", "defect_count"),
        ("二项概率边界检查", "序贯抽样停止条件", "成本口径核对", "后验或区间风险"),
        ("样本次品率不是已知真实概率", "回流和重复检测状态必须显式建模"),
    ),
    Adapter(
        "spectral_signal", "光谱与信号", ("光谱", "波数", "波长", "峰", "谷", "干涉", "频域"),
        ("sample_id", "wavenumber", "intensity"),
        ("单位与有效波段", "峰谷检测灵敏度", "连续区块留出", "残差和周期诊断"),
        ("密集光谱点通常相关", "相位定位和可见度判别是不同证据"),
    ),
)


def suggest(text: str, limit: int = 3) -> list[Adapter]:
    lowered = text.lower()
    ranked = []
    for adapter in ADAPTERS:
        score = sum(signal.lower() in lowered for signal in adapter.signals)
        if score:
            ranked.append((score, adapter))
    return [adapter for _, adapter in sorted(ranked, key=lambda item: (-item[0], item[1].name))[:limit]]
