---
title: 扩散模型的三种视角：去噪、Score 与 SDE
description: 同一个训练目标，三种看起来不同的推导方式，以及它们为什么等价。
date: 2026-11-01
tags: [diffusion, generative-models]
publish: true
---

扩散模型（Diffusion Models）至少有三种常见的推导：DDPM 的变分下界、Score Matching，以及连续时间的 SDE。它们最终落到同一个训练目标上——预测加进去的噪声。这篇文章试着把三者放在同一张图里。

> [!abstract] 一句话总结
> 三种视角给出的都是 $\nabla_x \log p_t(x)$ 的估计，只是参数化和时间离散化方式不同。

## 前向过程

给定数据 $x_0 \sim p_{\text{data}}$，前向过程逐步加高斯噪声：

$$
q(x_t \mid x_0) = \mathcal{N}\!\left(x_t;\ \sqrt{\bar\alpha_t}\, x_0,\ (1-\bar\alpha_t) I\right),
\qquad \bar\alpha_t = \prod_{s=1}^{t} (1-\beta_s).
$$

因此可以一步采样 $x_t = \sqrt{\bar\alpha_t}\,x_0 + \sqrt{1-\bar\alpha_t}\,\varepsilon$，其中 $\varepsilon \sim \mathcal N(0, I)$。

![[diffusion-forward.html]]

## 去噪视角

DDPM 把反向过程写成 $p_\theta(x_{t-1}\mid x_t)$，最大化 ELBO。化简后，每一项都是两个高斯之间的 KL，最终等价于一个加权的噪声回归[^ho]：

$$
\mathcal L_{\text{simple}} = \mathbb E_{t, x_0, \varepsilon}\left[\big\| \varepsilon - \varepsilon_\theta(x_t, t) \big\|^2\right].
$$

```python
def loss_fn(model, x0, alphas_bar):
    t = torch.randint(0, T, (x0.shape[0],), device=x0.device)
    eps = torch.randn_like(x0)
    a = alphas_bar[t].view(-1, 1, 1, 1)
    xt = a.sqrt() * x0 + (1 - a).sqrt() * eps
    return F.mse_loss(model(xt, t), eps)  # 预测噪声
```

## Score 视角

对高斯扰动，条件 score 有闭式解：

$$
\nabla_{x_t} \log q(x_t\mid x_0) = -\frac{x_t - \sqrt{\bar\alpha_t}\,x_0}{1-\bar\alpha_t} = -\frac{\varepsilon}{\sqrt{1-\bar\alpha_t}}.
$$

所以 ==预测噪声和预测 score 只差一个与 $t$ 有关的缩放==：$s_\theta(x_t,t) = -\varepsilon_\theta(x_t,t)/\sqrt{1-\bar\alpha_t}$。

![[score-field.svg]]

> [!tip]- 为什么 Denoising Score Matching 能学到边缘 score？
> Vincent (2011) 证明了条件 score 的回归目标与边缘 score 的回归目标只差一个与 $\theta$ 无关的常数，因此最优解相同。

## SDE 视角

把步数取到连续极限，前向过程变成一个 SDE，反向过程由 Anderson (1982) 的时间反演给出：

$$
\mathrm d x = \left[f(x,t) - g(t)^2 \nabla_x \log p_t(x)\right]\mathrm dt + g(t)\,\mathrm d\bar w .
$$

同一个 score 也定义了一个确定性的概率流 ODE，这正是 DDIM 和各类快速采样器的出发点。更基础的线性系统知识可以参考我的笔记 [[卷积与线性时不变系统|LTI 系统与卷积]]。

| 视角 | 参数化 | 时间 | 采样 |
| --- | --- | --- | --- |
| DDPM | $\varepsilon_\theta$ | 离散 | 祖先采样 |
| Score SDE | $s_\theta$ | 连续 | 反向 SDE / PF-ODE |
| Flow Matching | $v_\theta$ | 连续 | ODE |

[^ho]: Ho, Jain & Abbeel, *Denoising Diffusion Probabilistic Models*, NeurIPS 2020.
