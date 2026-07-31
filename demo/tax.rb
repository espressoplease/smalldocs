module Tax
  RATE = 0.20

  def self.apply(amount)
    amount + (amount * RATE)
  end
end
