from hone.stats import bootstrap_ci, judge_rates, pass_hat_k, rogan_gladen, summarize


def test_pass_hat_k():
    assert pass_hat_k(3, 3, 3) == 1
    assert pass_hat_k(2, 3, 3) == 0
    assert abs(pass_hat_k(4, 5, 3) - 0.4) < 1e-9  # C(4,3)/C(5,3)
    assert pass_hat_k(2, 3, 1) == 2 / 3


def test_summarize():
    pk, p1 = summarize([[True, True, True], [True, False, True]], 3)
    assert pk == 0.5 and abs(p1 - 5 / 6) < 1e-9


def test_rogan_gladen():
    # A perfect judge changes nothing; a chance-level judge can't be corrected.
    assert rogan_gladen(0.7, 1, 1) == 0.7
    assert rogan_gladen(0.7, 0.5, 0.5) is None
    # A judge that misses fails (low TNR) inflates the raw rate; correction lowers it.
    assert abs(rogan_gladen(0.5, 0.95, 0.8) - 0.4) < 1e-9  # (0.5 + 0.8 - 1) / 0.75


def test_judge_rates():
    pairs = [(True, True), (True, False), (False, False), (False, False)]
    assert judge_rates(pairs) == (0.5, 1.0)


def test_ci_contains_point():
    trials = [[True] * 3] * 7 + [[True, False, True]] * 3
    lo, hi = bootstrap_ci(trials, 3)
    assert lo <= 0.7 <= hi
