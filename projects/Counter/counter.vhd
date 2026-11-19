----------------------------------------------------------------------------------
-- Project Name : Counter
-- Module Name  : counter.vhd
-- Entity Name  : Counter
-- Architecture : Behavioral
-- Target Lang  : VHDL-2008
-- Description  : 4-bit synchronous binary counter with active-high synchronous clear
----------------------------------------------------------------------------------

library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity Counter is
  port (
    clk       : in  std_logic;
    clear     : in  std_logic;
    data_out  : out std_logic_vector(3 downto 0)
  );
end entity Counter;

architecture Behavioral of Counter is
  signal count : unsigned(3 downto 0) := (others => '0');
begin

  process (clk)
  begin
    if rising_edge(clk) then
      if clear = '1' then
        count <= (others => '0');
      else
        count <= count + 1;
      end if;
    end if;
  end process;

  data_out <= std_logic_vector(count);

end architecture Behavioral;
